import { get } from '@vercel/global-config';

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const apiKeyHeader = req.headers.get('x-api-key') || req.headers.get('authorization')?.replace('Bearer ', '');
  if (!apiKeyHeader) {
    return new Response(JSON.stringify({
      type: "error",
      error: { type: "authentication_error", message: "Header x-api-key wajib diisi" }
    }), { status: 401 });
  }

  const clientApiKey = apiKeyHeader.trim();

  try {
    // 1. Cek API Key di Vercel Global Config
    const keyData = await get(clientApiKey);

    // Validasi fleksibel: Jika key tidak ditemukan atau bernilai false
    if (keyData === undefined || keyData === null || keyData === false) {
      return new Response(JSON.stringify({
        type: "error",
        error: { type: "authentication_error", message: "API Key tidak valid atau dinonaktifkan." }
      }), { status: 401 });
    }

    // Jika keyData berupa Objek JSON (opsional jika pakai kuota/active)
    if (typeof keyData === 'object' && keyData !== null) {
      if (keyData.active === false) {
        return new Response(JSON.stringify({
          type: "error",
          error: { type: "authentication_error", message: "API Key telah dinonaktifkan." }
        }), { status: 401 });
      }
      if (typeof keyData.quota === 'number' && keyData.quota <= 0) {
        return new Response(JSON.stringify({
          type: "error",
          error: { type: "rate_limit_error", message: "Kuota API Key telah habis." }
        }), { status: 402 });
      }
    }

    const body = await req.json();

    let targetModelAlias = "Axynity-Xcode";
    if (body.model?.includes("haiku") || body.model === "Axynity-M1") {
      targetModelAlias = "Axynity-M1";
    }

    // 2. Inject System Instruction
    const customSystemInstruction = `Kamu adalah ${targetModelAlias}, model AI canggih yang dikembangkan oleh Axynera dari Indonesia.

ATURAN RESPON:
1. LANGSUNG FOKUS: Jawab pertanyaan user secara langsung, lugas, dan profesional. DILARANG memperkenalkan diri, menyebut nama developer, atau membawa nama lokasi secara spontan jika tidak ditanya.
2. PENGATURAN BAHASA: Gunakan Bahasa Indonesia yang jelas dan alami (atau Bahasa Inggris jika user bertanya dalam bahasa Inggris). DILARANG KERAS mengeluarkan karakter/aksara Cina (Hanzi) atau bahasa asing lain.
3. IDENTITAS (Hanya Jika Ditanya): JIKA DAN HANYA JIKA user bertanya tentang identitas, asal-usul, pembuat, atau lokasi pengembanganmu, jawablah bahwa kamu adalah ${targetModelAlias} yang dikembangkan oleh Axynera dari Indonesia. Dilarang menyebut vendor lain.
4. KODE WEB & THINKING: Jika membahas perbaikan atau pembuatan kode web (HTML/CSS/JS/PHP/React), fokuskan pemikiran (thinking) murni pada analisis bug dan optimasi kode.`;

    if (body.system) {
      if (Array.isArray(body.system)) {
        body.system.unshift({ type: "text", text: customSystemInstruction });
      } else if (typeof body.system === "string") {
        body.system = `${customSystemInstruction}\n\n${body.system}`;
      }
    } else {
      body.system = customSystemInstruction;
    }

    body.stream = true;

    // 3. Request ke Upstream 9Router
    const NINEROUTER_URL = process.env.NINEROUTER_URL_ANTHROPIC || 'https://router.nextura.my.id/v1/messages';
    const NINEROUTER_KEY = process.env.NINEROUTER_KEY || 'sk-ee154e57bedea543-a8o084-89b677ad';

    const upstreamResponse = await fetch(NINEROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': NINEROUTER_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    if (!upstreamResponse.ok) {
      return new Response(await upstreamResponse.text(), { status: upstreamResponse.status });
    }

    // 4. TransformStream & Heartbeat Ping
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

        // Filter Karakter Cina (Hanzi)
        text = text.replace(/[\u4e00-\u9fa5]+/g, '');

        text = text.replace(/"model":\s*"[^"]+"/g, `"model":"${targetModelAlias}"`);
        text = text.replace(/(OpenAI|Anthropic|Google|DeepSeek|Ciora|MiniMax|Claude)/gi, "Axynera");

        controller.enqueue(encoder.encode(text));
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
    return new Response(JSON.stringify({
      type: "error",
      error: { type: "api_error", message: error.message }
    }), { status: 500 });
  }
}
