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

    // 2. Normalisasi & Mapping Alias Model (Case-Insensitive)
    const rawModel = (body.model || '').toLowerCase();
    let targetModelAlias = "Axynity-Xcode";

    if (rawModel.includes("m1") || rawModel.includes("flash")) {
      targetModelAlias = "Axynity-M1";
    }

    // Pilihan streaming mengikuti request client (default: false jika tidak ada)
    const isStream = Boolean(body.stream);
    body.stream = isStream;

    // 3. Inject System Prompt yang Lebih Natural
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
    // PENANGANAN 1: NON-STREAMING RESPONSE (JSON biasa)
    // -------------------------------------------------------------
    if (!isStream) {
      const data = await upstreamResponse.json();

      // Timpa identitas & model
      data.model = targetModelAlias;
      data.developer = "Axynera";
      data.origin = "Indonesia";

      if (data.choices && Array.isArray(data.choices)) {
        data.choices.forEach(choice => {
          if (choice.message && choice.message.content) {
            // Filter karakter Hanzi dan ganti nama vendor
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

        // Filter Hanzi (Cina) & ganti string model upstream secara kasar di seluruh teks
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
