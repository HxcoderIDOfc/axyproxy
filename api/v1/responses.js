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
    // 1. Verifikasi API Key via Vercel Global Config
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

    // 2. Normalisasi Model & Ekstraksi Messages dari Payload Codex CLI /v1/responses
    const rawModel = (body.model || '').toLowerCase();
    let targetModelAlias = "Axynity-M1";

    if (rawModel.includes("xcode") || rawModel.includes("coder")) {
      targetModelAlias = "Axynity-Xcode";
    }

    let messages = body.messages || [];
    if (!messages.length && body.input) {
      if (typeof body.input === 'string') {
        messages = [{ role: 'user', content: body.input }];
      } else if (Array.isArray(body.input)) {
        messages = body.input;
      }
    }

    const customSystemPrompt = {
      role: "system",
      content: `Kamu adalah ${targetModelAlias}, asisten AI cerdas dan serbaguna yang dikembangkan oleh Axynera.

PANDUAN BERKOMUNIKASI:
1. GAYA BAHASA: Gunakan Bahasa Indonesia yang natural, hangat, ramah, dan komunikatif.
2. JAWABAN FOKUS: Jawab inti pertanyaan pengguna dengan jelas dan solutif.
3. IDENTITAS & DEVELOPER: Kamu adalah model AI ${targetModelAlias} ciptaan Axynera, tim/pengembang dari Indonesia. DILARANG KERAS menyebutkan atau mengaitkan dirimu dengan vendor/model lain (OpenAI, Anthropic, Google, DeepSeek, ChatGPT, Claude, Gemini).
4. FILTER BAHASA: HANYA gunakan karakter latin/alfabet biasa. DILARANG KERAS menampilkan aksara Cina/Hanzi (汉字).
5. PENULISAN KODE: Bekerja dengan presisi tinggi untuk analisa logika, arsitektur kode bersih, dan perbaikan bug.`
    };

    messages.unshift(customSystemPrompt);

    // 3. Construct Payload untuk Upstream Chat Completions
    const upstreamBody = {
      model: targetModelAlias,
      messages: messages,
      stream: true,
      temperature: body.temperature ?? 0.7,
      max_tokens: body.max_tokens ?? 4096
    };

    const NINEROUTER_URL = process.env.NINEROUTER_URL || 'https://router.nextura.my.id/v1/chat/completions';
    const NINEROUTER_KEY = process.env.NINEROUTER_KEY || 'sk-ee154e57bedea543-a8o084-89b677ad';

    const upstreamResponse = await fetch(NINEROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${NINEROUTER_KEY}`
      },
      body: JSON.stringify(upstreamBody)
    });

    if (!upstreamResponse.ok) {
      return new Response(await upstreamResponse.text(), { status: upstreamResponse.status });
    }

    // 4. Stream Transformer agar Kompatibel dengan Format Stream Responses Codex
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
