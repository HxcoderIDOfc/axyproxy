import { get } from '@vercel/global-config';

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Authorization header wajib diisi' }), { status: 401 });
  }

  const clientApiKey = authHeader.replace('Bearer ', '').trim();

  try {
    // 1. Cek API Key di Vercel Global Config
    const keyData = await get(clientApiKey);

    if (keyData === undefined || keyData === null || keyData === false) {
      return new Response(JSON.stringify({ error: 'API Key tidak valid atau dinonaktifkan.' }), { status: 401 });
    }

    if (typeof keyData === 'object' && keyData !== null) {
      if (keyData.active === false) {
        return new Response(JSON.stringify({ error: 'API Key dinonaktifkan.' }), { status: 401 });
      }
      if (typeof keyData.quota === 'number' && keyData.quota <= 0) {
        return new Response(JSON.stringify({ error: 'Kuota API Key telah habis.' }), { status: 402 });
      }
    }

    const body = await req.json();

    // 2. Normalisasi & Mapping Alias Model
    const rawModel = (body.model || '').toLowerCase();
    let targetModelAlias = "Axynity-Xcode";

    if (rawModel.includes("m1") || rawModel.includes("flash")) {
      targetModelAlias = "Axynity-M1";
    }

    const isStream = Boolean(body.stream);
    body.stream = isStream;

    // 3. Penanganan Prompt untuk Endpoint /v1/completions
    const systemInstruction = `Kamu adalah ${targetModelAlias}, asisten AI cerdas dan serbaguna yang dikembangkan oleh Axynera.

PANDUAN BERKOMUNIKASI:
1. GAYA BAHASA: Gunakan Bahasa Indonesia yang natural, hangat, ramah, dan komunikatif.
2. JAWABAN FOKUS: Utamakan langsung menjawab inti pertanyaan pengguna. Jangan membawa-bawa identitas atau pembuat secara otomatis jika tidak ditanyakan.
3. IDENTITAS & DEVELOPER: Jawablah santai bahwa kamu adalah model AI ${targetModelAlias} ciptaan Axynera. DILARANG KERAS menyebutkan atau mengaitkan dirimu dengan vendor/model lain.
4. FILTER BAHASA: HANYA gunakan karakter latin/alfabet biasa. DILARANG KERAS menampilkan aksara Cina/Hanzi (汉字).
5. PENULISAN KODE: Fokuskan analisa pada logika, arsitektur kode bersih, dan perbaikan bug secara teknis.`;

    if (body.prompt) {
      if (typeof body.prompt === 'string') {
        body.prompt = `${systemInstruction}\n\n${body.prompt}`;
      } else if (Array.isArray(body.prompt)) {
        body.prompt = [systemInstruction, ...body.prompt];
      }
    } else if (body.messages && Array.isArray(body.messages)) {
      body.messages.unshift({ role: "system", content: systemInstruction });
    }

    // 4. Request ke Upstream 9Router
    const NINEROUTER_URL = process.env.NINEROUTER_COMPLETIONS_URL || process.env.NINEROUTER_URL || 'https://router.nextura.my.id/v1/completions';
    const NINEROUTER_KEY = process.env.NINEROUTER_KEY || 'sk-ee154e57bedea543-a8o084-89b677ad';

    const upstreamResponse = await fetch(NINEROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${NINEROUTER_KEY}`
      },
      body: JSON.stringify(body)
    });

    if (!upstreamResponse.ok) {
      return new Response(await upstreamResponse.text(), { status: upstreamResponse.status });
    }

    // -------------------------------------------------------------
    // NON-STREAMING RESPONSE
    // -------------------------------------------------------------
    if (!isStream) {
      const data = await upstreamResponse.json();

      data.model = targetModelAlias;
      data.developer = "Axynera";
      data.origin = "Indonesia";

      if (data.choices && Array.isArray(data.choices)) {
        data.choices.forEach(choice => {
          if (choice.text) {
            choice.text = choice.text
              .replace(/[\u4e00-\u9fa5]+/g, '')
              .replace(/(OpenAI|Anthropic|Google|DeepSeek|ChatGPT|Claude)/gi, "Axynera");
          }
          if (choice.message && choice.message.content) {
            choice.message.content = choice.message.content
              .replace(/[\u4e00-\u9fa5]+/g, '')
              .replace(/(OpenAI|Anthropic|Google|DeepSeek|ChatGPT|Claude)/gi, "Axynera");
          }
        });
      }

      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
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

              data.model = targetModelAlias;
              data.developer = "Axynera";
              data.origin = "Indonesia";

              if (data.choices && data.choices[0]) {
                if (data.choices[0].text) {
                  data.choices[0].text = data.choices[0].text
                    .replace(/(OpenAI|Anthropic|Google|DeepSeek|ChatGPT|Claude)/gi, "Axynera");
                }
                if (data.choices[0].delta?.content) {
                  data.choices[0].delta.content = data.choices[0].delta.content
                    .replace(/(OpenAI|Anthropic|Google|DeepSeek|ChatGPT|Claude)/gi, "Axynera");
                }
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
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: 'Proxy Internal Error', details: error.message }), { status: 500 });
  }
}
