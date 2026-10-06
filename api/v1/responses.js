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

    // 2. Mapping Model & Normalisasi Prompt
    const rawModel = (body.model || '').toLowerCase();
    let targetModelAlias = "Axynity-Xcode";

    if (rawModel.includes("m1") || rawModel.includes("flash")) {
      targetModelAlias = "Axynity-M1";
    }

    // Tangkap input/messages dari payload /v1/responses Codex
    let formattedMessages = [];
    
    if (body.messages && Array.isArray(body.messages)) {
      formattedMessages = [...body.messages];
    } else if (body.input) {
      formattedMessages = [{ role: "user", content: body.input }];
    } else if (body.prompt) {
      formattedMessages = [{ role: "user", content: body.prompt }];
    } else {
      formattedMessages = [{ role: "user", content: "hallo" }];
    }

    // Sisipkan system prompt identitas Axynera
    formattedMessages.unshift({
      role: "system",
      content: `Kamu adalah ${targetModelAlias}, asisten AI cerdas ciptaan Axynera dari Indonesia. Jawab secara jelas dan komunikatif. HANYA gunakan karakter latin/alfabet biasa (DILARANG karakter Cina/Hanzi).`
    });

    const isStream = body.stream !== undefined ? Boolean(body.stream) : true;

    const chatPayload = {
      model: targetModelAlias,
      messages: formattedMessages,
      stream: isStream
    };

    // 3. Request ke Upstream Router
    const NINEROUTER_URL = process.env.NINEROUTER_URL || 'https://router.nextura.my.id/v1/chat/completions';
    const NINEROUTER_KEY = process.env.NINEROUTER_KEY || 'sk-ee154e57bedea543-a8o084-89b677ad';

    const upstreamResponse = await fetch(NINEROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${NINEROUTER_KEY}`
      },
      body: JSON.stringify(chatPayload)
    });

    if (!upstreamResponse.ok) {
      return new Response(await upstreamResponse.text(), { 
        status: upstreamResponse.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // 4. Non-Streaming Response
    if (!isStream) {
      const data = await upstreamResponse.json();
      data.model = targetModelAlias;
      data.developer = "Axynera";
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 5. Streaming Response (SSE Transform)
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new TransformStream({
      transform(chunk, controller) {
        let text = decoder.decode(chunk, { stream: true });
        // Filter Hanzi & ganti nama vendor
        text = text.replace(/[\u4e00-\u9fa5]+/g, '');
        text = text.replace(/(OpenAI|Anthropic|Google|DeepSeek|ChatGPT|Claude)/gi, "Axynera");
        controller.enqueue(encoder.encode(text));
      }
    });

    const transformedStream = upstreamResponse.body.pipeThrough(stream);

    return new Response(transformedStream, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
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
