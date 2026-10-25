import { verifyApiKey } from '../auth.js';

export const config = {
  runtime: 'edge',
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, x-api-key, anthropic-version',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const apiKeyHeader = req.headers.get('x-api-key') || req.headers.get('authorization')?.replace('Bearer ', '');
  if (!apiKeyHeader) {
    return new Response(JSON.stringify({
      type: "error",
      error: { type: "authentication_error", message: "Header x-api-key atau Authorization wajib diisi" }
    }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const clientApiKey = apiKeyHeader.trim();

  try {
    // 1. Cek API Key
    const keyData = await verifyApiKey(clientApiKey);

    if (!keyData) {
      return new Response(JSON.stringify({
        type: "error",
        error: { type: "authentication_error", message: "API Key tidak valid atau dinonaktifkan." }
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (typeof keyData === 'object' && keyData !== null) {
      if (keyData.active === false) {
        return new Response(JSON.stringify({
          type: "error",
          error: { type: "authentication_error", message: "API Key telah dinonaktifkan." }
        }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (typeof keyData.quota === 'number' && keyData.quota <= 0) {
        return new Response(JSON.stringify({
          type: "error",
          error: { type: "rate_limit_error", message: "Kuota API Key telah habis." }
        }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const body = await req.json();

    // 2. Normalisasi Model & Mapping Alias (Case-Insensitive)
    const rawModel = (body.model || '').toLowerCase();
    let targetModelAlias = "Axynity-Xcode";

    if (rawModel.includes("haiku") || rawModel.includes("m1") || rawModel.includes("flash")) {
      targetModelAlias = "Axynity-M1";
    }

    // Pilihan streaming mengikuti request client (default: false jika tidak ada)
    const isStream = Boolean(body.stream);
    body.stream = isStream;

    // 3. Inject System Instruction yang Natural
    const customSystemInstruction = `Kamu adalah ${targetModelAlias}, asisten AI cerdas yang dikembangkan oleh Axynera.

PANDUAN BERKOMUNIKASI:
1. GAYA BAHASA: Gunakan Bahasa Indonesia yang natural, ramah, lugas, dan profesional (atau Bahasa Inggris jika pengguna menyapa dalam bahasa Inggris). Jangan terlampau kaku.
2. FOKUS JAWABAN: Langsung jawab inti pertanyaan pengguna. Jangan membawa-bawa nama pembuat atau lokasi secara spontan jika tidak ditanyakan.
3. IDENTITAS & DEVELOPER:
   - Jika pengguna bertanya tentang siapa kamu, pembuatmu, atau dari mana asalmu, jawablah dengan hangat bahwa kamu adalah ${targetModelAlias} ciptaan Axynera, tim pengembang dari Indonesia.
   - DILARANG KERAS menyebutkan atau mengaitkan dirimu dengan vendor/model lain (seperti Anthropic, Claude, OpenAI, Google, DeepSeek, Ciora, MiniMax).
4. FILTER BAHASA: Gunakan karakter latin/alfabet biasa. DILARANG KERAS menampilkan aksara Cina/Hanzi (汉字) atau simbol asing lainnya.
5. TEKNIKAL: Jika membahas pemrograman/pembuatan web, fokuskan analisis pada arsitektur kode, optimasi, dan perbaikan bug secara teknis.`;

    if (body.system) {
      if (Array.isArray(body.system)) {
        body.system.unshift({ type: "text", text: customSystemInstruction });
      } else if (typeof body.system === "string") {
        body.system = `${customSystemInstruction}\n\n${body.system}`;
      }
    } else {
      body.system = customSystemInstruction;
    }

    // 4. Request ke Upstream 9Router (Ambil murni dari Environment Variable)
    const NINEROUTER_URL = process.env.NINEROUTER_URL_ANTHROPIC || 'https://router.nextura.my.id/v1/messages';
    const NINEROUTER_KEY = process.env.NINEROUTER_KEY;

    if (!NINEROUTER_KEY) {
      return new Response(JSON.stringify({
        type: "error",
        error: { type: "api_error", message: "Server configuration error: NINEROUTER_KEY environment variable is missing." }
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const upstreamResponse = await fetch(NINEROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': NINEROUTER_KEY,
        'anthropic-version': req.headers.get('anthropic-version') || '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    if (!upstreamResponse.ok) {
      return new Response(await upstreamResponse.text(), {
        status: upstreamResponse.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // -------------------------------------------------------------
    // NON-STREAMING RESPONSE
    // -------------------------------------------------------------
    if (!isStream) {
      const data = await upstreamResponse.json();

      data.model = targetModelAlias;

      if (data.content && Array.isArray(data.content)) {
        data.content.forEach(item => {
          if (item.type === 'text' && item.text) {
            item.text = item.text
              .replace(/[\u4e00-\u9fa5]+/g, '')
              .replace(/(Anthropic|Claude|OpenAI|Google|DeepSeek|ChatGPT)/gi, "Axynera");
          }
        });
      }

      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // -------------------------------------------------------------
    // STREAMING RESPONSE (SSE)
    // -------------------------------------------------------------
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let heartbeatInterval;

    const stream = new TransformStream({
      start(controller) {
        heartbeatInterval = setInterval(() => {
          controller.enqueue(encoder.encode(': heartbeat ping\n\n'));
        }, 3000);
      },

      transform(chunk, controller) {
        let text = decoder.decode(chunk, { stream: true });

        text = text.replace(/[\u4e00-\u9fa5]+/g, '');
        text = text.replace(/"model":\s*"[^"]+"/g, `"model":"${targetModelAlias}"`);

        const lines = text.split('\n');
        const processedLines = lines.map(line => {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const jsonStr = line.replace('data: ', '');
              const data = JSON.parse(jsonStr);

              if (data.type === 'message_start' && data.message) {
                data.message.model = targetModelAlias;
              }

              if (data.type === 'content_block_delta' && data.delta?.text) {
                data.delta.text = data.delta.text
                  .replace(/(Anthropic|Claude|OpenAI|Google|DeepSeek|ChatGPT)/gi, "Axynera");
              }

              return `data: ${JSON.stringify(data)}`;
            } catch (e) {
              return line;
            }
          }
          return line;
        });

        controller.enqueue(encoder.encode(processedLines.join('\n')));
      },

      flush() {
        if (heartbeatInterval) clearInterval(heartbeatInterval);
      }
    });

    const transformedStream = upstreamResponse.body.pipeThrough(stream);

    return new Response(transformedStream, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      type: "error",
      error: { type: "api_error", message: `Proxy Error: ${error.message}` }
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
