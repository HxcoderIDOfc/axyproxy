import { get } from '@vercel/global-config';

export const config = {
  runtime: 'edge',
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, x-api-key',
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

  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Authorization header wajib diisi' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const clientApiKey = authHeader.replace('Bearer ', '').trim();

  try {
    // 1. Cek API Key di Vercel Global Config
    const keyData = await get(clientApiKey);

    if (keyData === undefined || keyData === null || keyData === false) {
      return new Response(JSON.stringify({ error: 'API Key tidak valid atau dinonaktifkan.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (typeof keyData === 'object' && keyData !== null) {
      if (keyData.active === false) {
        return new Response(JSON.stringify({ error: 'API Key dinonaktifkan.' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (typeof keyData.quota === 'number' && keyData.quota <= 0) {
        return new Response(JSON.stringify({ error: 'Kuota API Key telah habis.' }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const body = await req.json();

    // 2. Normalisasi & Mapping Alias Model
    const rawModel = (body.model || '').toLowerCase();
    let targetModelAlias = "Axynity-Xcode";

    if (rawModel.includes("m1") || rawModel.includes("flash")) {
      targetModelAlias = "Axynity-M1";
    }

    // Deteksi apakah request mengirim gambar (Vision / Multimodal)
    const hasImage = body.messages && Array.isArray(body.messages) && body.messages.some(m => {
      if (Array.isArray(m.content)) {
        return m.content.some(c => c.type === 'image_url');
      }
      return false;
    });

    let upstreamModel = body.model || "axynity-M1";
    if (hasImage) {
      // Gunakan model vision terverifikasi aktif & stabil
      upstreamModel = "cl/nvidia/nemotron-3.5-super-vl:free";
    } else if (rawModel.includes("m1") || rawModel.includes("flash")) {
      upstreamModel = "axynity-M1";
    } else if (rawModel.includes("xcode") || rawModel.includes("pro")) {
      upstreamModel = "axynity-Xcode";
    }

    body.model = upstreamModel;

    // Pilihan streaming mengikuti request client
    const isStream = Boolean(body.stream);
    body.stream = isStream;

    // 3. Inject System Prompt
    const customSystemPrompt = {
      role: "system",
      content: `Kamu adalah ${targetModelAlias}, asisten AI cerdas dan serbaguna yang dikembangkan oleh Axynera.

PANDUAN BERKOMUNIKASI:
1. GAYA BAHASA: Gunakan Bahasa Indonesia yang natural, hangat, ramah, dan komunikatif (atau Bahasa Inggris sesuai bahasa pengguna). Jangan kaku seperti robot.
2. JAWABAN FOKUS: Utamakan langsung menjawab inti pertanyaan pengguna dengan jelas dan solutif. Jangan membawa-bawa identitas atau pembuat secara otomatis jika tidak ditanyakan.
3. IDENTITAS & DEVELOPER:
   - Jika pengguna bertanya tentang siapa kamu, siapa pembuatmu, atau dari mana asalmmu, jawablah dengan santai dan bangga bahwa kamu adalah model AI ${targetModelAlias} ciptaan Axynera, tim/pengembang dari Indonesia.
   - DILARANG KERAS menyebutkan atau mengaitkan dirimu dengan vendor/model lain (seperti OpenAI, Anthropic, Google, DeepSeek, ChatGPT, Claude, atau Gemini).
4. FILTER BAHASA: HANYA gunakan karakter latin/alfabet biasa. DILARANG KERAS menampilkan aksara Cina/Hanzi (汉字) atau simbol asing yang tidak perlu.
5. PENULISAN KODE: Jika pengguna meminta bantuan pemrograman, fokuskan analisa pada logika, arsitektur kode yang bersih, dan perbaikan bug secara teknis.`
    };

    if (body.messages && Array.isArray(body.messages)) {
      body.messages.unshift(customSystemPrompt);
    } else {
      body.messages = [customSystemPrompt];
    }

    // 4. Request ke Upstream 9Router
    const NINEROUTER_URL = process.env.NINEROUTER_URL || 'https://router.nextura.my.id/v1/chat/completions';
    const NINEROUTER_KEY = process.env.NINEROUTER_KEY;

    if (!NINEROUTER_KEY) {
      return new Response(JSON.stringify({ error: 'Server configuration error: NINEROUTER_KEY environment variable is missing.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const upstreamResponse = await fetch(NINEROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${NINEROUTER_KEY}`
      },
      body: JSON.stringify(body)
    });

    if (!upstreamResponse.ok) {
      const errText = await upstreamResponse.text();
      return new Response(errText, {
        status: upstreamResponse.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // -------------------------------------------------------------
    // PENANGANAN 1: NON-STREAMING RESPONSE (JSON biasa)
    // -------------------------------------------------------------
    if (!isStream) {
      const rawText = await upstreamResponse.text();
      let data;
      try {
        const cleanedJsonStr = rawText.replace(/\n*data:\s*\[DONE\].*$/s, '').trim();
        data = JSON.parse(cleanedJsonStr);
      } catch (err) {
        const firstBrace = rawText.indexOf('{');
        const lastBrace = rawText.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1) {
          data = JSON.parse(rawText.slice(firstBrace, lastBrace + 1));
        } else {
          throw err;
        }
      }

      // Normalisasi jika 9Router membungkus response di dalam { data: { choices: [...] } }
      if (data.data && data.data.choices && !data.choices) {
        data = { ...data.data, success: data.success };
      }

      // Timpa identitas & model
      data.model = targetModelAlias;
      data.developer = "Axynera";
      data.origin = "Indonesia";

      if (data.choices && Array.isArray(data.choices)) {
        data.choices.forEach(choice => {
          if (choice.message && choice.message.content) {
            choice.message.content = choice.message.content
              .replace(/^[\r\n\s]+/, '') // Hapus enter kosong di awal kalimat!
              .replace(/[\u4e00-\u9fa5]+/g, '')
              .replace(/(OpenAI|Anthropic|Google|DeepSeek|ChatGPT|Claude)/gi, "Axynera");
          }
        });
      }

      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // -------------------------------------------------------------
    // PENANGANAN 2: STREAMING RESPONSE (SSE)
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

              data.model = targetModelAlias;
              data.developer = "Axynera";
              data.origin = "Indonesia";

              if (data.choices && data.choices[0]?.delta?.reasoning_content) {
                data.choices[0].delta.reasoning_content = data.choices[0].delta.reasoning_content
                  .replace(/(OpenAI|Anthropic|Google|DeepSeek|ChatGPT|Claude)/gi, "Axynera Engine");
              }

              if (data.choices && data.choices[0]?.delta?.content) {
                data.choices[0].delta.content = data.choices[0].delta.content
                  .replace(/(OpenAI|Anthropic|Google|DeepSeek|ChatGPT|Claude)/gi, "Axynera");
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
    return new Response(JSON.stringify({ error: 'Proxy Internal Error', details: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
