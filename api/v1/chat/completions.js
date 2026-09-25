import { kv } from '@vercel/kv';

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  // 1. Validasi Authorization Header
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Authorization header wajib diisi' }), { status: 401 });
  }

  const clientApiKey = authHeader.replace('Bearer ', '').trim();

  try {
    // 2. Cek API Key & Kuota Pengguna di Vercel KV Database
    const keyData = await kv.get(`key:${clientApiKey}`);
    if (!keyData || !keyData.active) {
      return new Response(JSON.stringify({ error: 'API Key tidak valid atau telah dinonaktifkan.' }), { status: 401 });
    }

    if (keyData.quota <= 0) {
      return new Response(JSON.stringify({ error: 'Kuota API Key kamu telah habis.' }), { status: 402 });
    }

    const body = await req.json();

    // Mapping Alias Model
    let targetModelAlias = "Axynity-Xcode";
    if (body.model === "Axynity-M1" || body.model === "axynity-m1" || body.model === "Axynity flash") {
      targetModelAlias = "Axynity-M1";
    }

    // 3. Inject System Prompt (Natural & Kondisional)
    const customSystemPrompt = {
      role: "system",
      content: `Kamu adalah ${targetModelAlias}, model AI canggih yang dikembangkan oleh Axynera dari Indonesia.

ATURAN RESPON:
1. LANGSUNG FOKUS: Jawab pertanyaan user secara langsung, lugas, dan profesional. DILARANG memperkenalkan diri, menyebut nama developer, atau membawa nama lokasi secara spontan jika tidak ditanya.
2. PENGATURAN BAHASA: Gunakan Bahasa Indonesia yang jelas dan alami (atau Bahasa Inggris jika user bertanya dalam bahasa Inggris). DILARANG KERAS mengeluarkan karakter/aksara Cina (Hanzi) atau bahasa asing lain yang tidak relevan.
3. IDENTITAS (Hanya Jika Ditanya): JIKA DAN HANYA JIKA user bertanya tentang identitas, asal-usul, pembuat, atau lokasi pengembanganmu, jawablah bahwa kamu adalah ${targetModelAlias} yang dikembangkan oleh Axynera dari Indonesia. Dilarang menyebut vendor lain (seperti OpenAI, Anthropic, Google, DeepSeek, Ciora, MiniMax).
4. KODE WEB & THINKING: Jika membahas perbaikan atau pembuatan kode web (HTML/CSS/JS/PHP/React), fokuskan proses pemikiran (thinking) murni pada analisis bug, sintaks, dan optimasi kode secara teknis.`
    };

    if (body.messages && Array.isArray(body.messages)) {
      body.messages.unshift(customSystemPrompt);
    } else {
      body.messages = [customSystemPrompt];
    }

    body.stream = true;

    // 4. Request ke Upstream 9Router Gateway
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

    // Potong Kuota User (-1 per request)
    await kv.set(`key:${clientApiKey}`, { ...keyData, quota: keyData.quota - 1 });

    // 5. TransformStream: Custom JSON SSE + Heartbeat Ping + Clean Chinese & Vendor Filter
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let heartbeatInterval;

    const stream = new TransformStream({
      start(controller) {
        // Heartbeat Ping setiap 3 detik untuk mencegah Vercel Timeout
        heartbeatInterval = setInterval(() => {
          controller.enqueue(encoder.encode(': heartbeat ping\n\n'));
        }, 3000);
      },

      transform(chunk, controller) {
        let text = decoder.decode(chunk, { stream: true });

        // Filter Karakter Cina (Hanzi)
        text = text.replace(/[\u4e00-\u9fa5]+/g, '');

        // Rebrand JSON SSE
        const lines = text.split('\n');
        const processedLines = lines.map(line => {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const jsonStr = line.replace('data: ', '');
              const data = JSON.parse(jsonStr);

              // Override Metadata JSON
              data.model = targetModelAlias;
              data.developer = "Axynera";
              data.origin = "Indonesia";

              // Clean Thinking / Reasoning Content
              if (data.choices && data.choices[0]?.delta?.reasoning_content) {
                data.choices[0].delta.reasoning_content = data.choices[0].delta.reasoning_content
                  .replace(/(OpenAI|Anthropic|Google|DeepSeek|Ciora|MiniMax)/gi, "Axynera AI Engine");
              }

              // Clean Main Content
              if (data.choices && data.choices[0]?.delta?.content) {
                data.choices[0].delta.content = data.choices[0].delta.content
                  .replace(/(OpenAI|Anthropic|Google|DeepSeek|Ciora|MiniMax)/gi, "Axynera");
              }

              return `data: ${JSON.stringify(data)}`;
            } catch (e) {
              return line.replace(/"model":\s*"[^"]+"/g, `"model":"${targetModelAlias}"`);
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
