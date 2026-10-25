import { verifyApiKey } from '../../auth.js';

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
    // 1. Cek API Key
    const keyData = await verifyApiKey(clientApiKey);

    if (!keyData) {
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

    if (!body.input) {
      return new Response(JSON.stringify({ error: 'Parameter input wajib diisi' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Request ke Upstream 9Router
    const NINEROUTER_AUDIO_SPEECH_URL = process.env.NINEROUTER_AUDIO_SPEECH_URL || 'https://router.nextura.my.id/v1/audio/speech';
    const NINEROUTER_KEY = process.env.NINEROUTER_KEY;

    if (!NINEROUTER_KEY) {
      return new Response(JSON.stringify({ error: 'Server configuration error: NINEROUTER_KEY environment variable is missing.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const upstreamResponse = await fetch(NINEROUTER_AUDIO_SPEECH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${NINEROUTER_KEY}`
      },
      body: JSON.stringify(body)
    });

    const contentType = upstreamResponse.headers.get('content-type') || 'audio/mpeg';

    if (!upstreamResponse.ok) {
      const errorText = await upstreamResponse.text();
      return new Response(errorText, {
        status: upstreamResponse.status,
        headers: { ...corsHeaders, 'Content-Type': contentType },
      });
    }

    // Binary audio stream forward
    return new Response(upstreamResponse.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': contentType,
      },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: 'Proxy Internal Error', details: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
