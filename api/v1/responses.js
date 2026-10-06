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
    const keyData = await get(clientApiKey);
    if (!keyData || keyData.active === false) {
      return new Response(JSON.stringify({ error: 'API Key tidak valid atau dinonaktifkan.' }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const body = await req.json();

    let clientModel = body.model || "axynity-Xcode";
    if (clientModel.toLowerCase() === "axynity-m1") {
      clientModel = "axynity-M1";
    } else if (clientModel.toLowerCase() === "axynity-xcode") {
      clientModel = "axynity-Xcode";
    }

    const isStream = Boolean(body.stream);

    const customSystemPrompt = {
      role: "system",
      content: `Kamu adalah ${clientModel}, asisten AI cerdas ciptaan Axynera dari Indonesia. DILARANG KERAS menyebutkan vendor lain. HANYA gunakan karakter latin/alfabet biasa (DILARANG Hanzi).`
    };

    let rawMessages = [];
    if (body.messages && Array.isArray(body.messages)) {
      rawMessages = body.messages;
    } else if (body.input) {
      rawMessages = [{ role: "user", content: body.input }];
    } else if (body.prompt) {
      rawMessages = [{ role: "user", content: body.prompt }];
    } else {
      rawMessages = [{ role: "user", content: "hallo" }];
    }

    let safeMessages = rawMessages.map(msg => {
      let textContent = msg.content;
      if (Array.isArray(textContent)) {
        textContent = textContent.map(c => c.text || (typeof c === 'string' ? c : '')).join('\n');
      } else if (typeof textContent === 'object') {
        textContent = JSON.stringify(textContent);
      }
      return { role: msg.role || "user", content: textContent || "" };
    });

    safeMessages.unshift(customSystemPrompt);

    const upstreamPayload = {
      ...body,
      model: clientModel,
      messages: safeMessages,
      stream: isStream
    };

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

    if (!isStream) {
      const data = await upstreamResponse.json();
      data.model = clientModel;
      data.developer = "Axynera";
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Pass-through stream murni tanpa manipulasi string agresif yang bikin putus
    const upstreamBody = upstreamResponse.body;

    return new Response(upstreamBody, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: 'Proxy Internal Error', details: error.message }), { 
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}
