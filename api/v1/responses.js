import { get } from '@vercel/global-config';

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { 
      status: 405, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }

  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Authorization header wajib diisi' }), { 
      status: 401, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }

  const clientApiKey = authHeader.replace('Bearer ', '').trim();

  try {
    // 1. Cek API Key di Vercel Global Config
    const keyData = await get(clientApiKey);

    if (keyData === undefined || keyData === null || keyData === false) {
      return new Response(JSON.stringify({ error: 'API Key tidak valid atau dinonaktifkan.' }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    if (typeof keyData === 'object' && keyData !== null) {
      if (keyData.active === false) {
        return new Response(JSON.stringify({ error: 'API Key dinonaktifkan.' }), { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }
      if (typeof keyData.quota === 'number' && keyData.quota <= 0) {
        return new Response(JSON.stringify({ error: 'Kuota API Key telah habis.' }), { 
          status: 402, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }
    }

    const body = await req.json();

    // 2. Pertahankan model asli dari client
    const clientModel = body.model || "Axynity-Xcode";
    const isStream = Boolean(body.stream);

    // 3. System prompt & Normalisasi Messages/Prompt Codex
    const customSystemPrompt = {
      role: "system",
      content: `Kamu adalah ${clientModel}, asisten AI cerdas dan serbaguna yang dikembangkan oleh Axynera.

PANDUAN BERKOMUNIKASI:
1. GAYA BAHASA: Gunakan Bahasa Indonesia yang natural, hangat, ramah, dan komunikatif.
2. JAWABAN FOKUS: Utamakan langsung menjawab inti pertanyaan pengguna.
3. IDENTITAS & DEVELOPER: Kamu adalah model AI ${clientModel} ciptaan Axynera dari Indonesia. DILARANG KERAS menyebutkan vendor/model lain.
4. FILTER BAHASA: HANYA gunakan karakter latin/alfabet biasa. DILARANG KERAS menampilkan aksara Cina/Hanzi (汉字).
5. PENULISAN KODE: Fokuskan analisa pada logika dan arsitektur kode yang bersih.`
    };

    let formattedMessages = [];
    if (body.messages && Array.isArray(body.messages)) {
      formattedMessages = [customSystemPrompt, ...body.messages];
    } else if (body.input) {
      formattedMessages = [customSystemPrompt, { role: "user", content: body.input }];
    } else if (body.prompt) {
      formattedMessages = [customSystemPrompt, { role: "user", content: body.prompt }];
    } else {
      formattedMessages = [customSystemPrompt, { role: "user", content: "hallo" }];
    }

    // Payload dengan model yang tetap sama seperti request client
    const upstreamPayload = {
      ...body,
      model: clientModel,
      messages: formattedMessages,
      stream: isStream
    };

    // 4. Forward request ke Upstream 9Router
    const NINEROUTER_URL = process.env.NINEROUTER_URL || 'https://router.nextura.my.id/v1/chat/completions';
    const NINEROUTER_KEY = process.env.NINEROUTER_KEY || 'sk-ee154e57bedea543-a8o084-89b677ad';

    const upstreamResponse = await fetch(NINEROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${NINEROUTER_KEY}`
      },
      body: JSON.stringify(upstreamPayload)
    });

    if (!upstreamResponse.ok) {
      return new Response(await upstreamResponse.text(), { 
        status: upstreamResponse.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // -------------------------------------------------------------
    // PENANGANAN 1: NON-STREAMING RESPONSE
    // -------------------------------------------------------------
    if (!isStream) {
      const data = await upstreamResponse.json();

      data.model = clientModel;
      data.developer = "Axynera";
      data.origin = "Indonesia";

      if (data.choices && Array.isArray(data.choices)) {
        data.choices.forEach(choice => {
          if (choice.message && choice.message.content) {
            choice.message.content = choice.message.content
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

        const lines = text.split('\n');
        const processedLines = lines.map(line => {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const jsonStr = line.replace('data: ', '');
              const data = JSON.parse(jsonStr);

              data.model = clientModel;
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
      },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: 'Proxy Internal Error', details: error.message }), { 
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}
