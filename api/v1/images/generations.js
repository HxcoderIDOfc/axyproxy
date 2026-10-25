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

    if (!body.prompt) {
      return new Response(JSON.stringify({ error: 'Parameter prompt wajib diisi' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Normalisasi & Mapping Model Gambar Axynera
    const rawModel = (body.model || '').toLowerCase();
    let upstreamModel = "cf/@cf/black-forest-labs/flux-2-klein-4b"; // Default hemat & bagus (FLUX 2 Klein)

    if (rawModel.includes("lightning") || rawModel.includes("fast") || rawModel.includes("sdxl")) {
      upstreamModel = "cf/@cf/bytedance/stable-diffusion-xl-lightning";
    } else if (rawModel.includes("anime") || rawModel.includes("dreamshaper")) {
      upstreamModel = "cf/@cf/lykon/dreamshaper-8-lcm";
    } else if (rawModel.startsWith("cf/") || rawModel.includes("@cf/")) {
      upstreamModel = body.model;
    }

    body.model = upstreamModel;

    // 3. Request ke Upstream 9Router
    const NINEROUTER_IMAGE_URL = process.env.NINEROUTER_IMAGE_URL || 'https://router.nextura.my.id/v1/images/generations';
    const NINEROUTER_KEY = process.env.NINEROUTER_KEY;

    if (!NINEROUTER_KEY) {
      return new Response(JSON.stringify({ error: 'Server configuration error: NINEROUTER_KEY environment variable is missing.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const upstreamResponse = await fetch(NINEROUTER_IMAGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${NINEROUTER_KEY}`
      },
      body: JSON.stringify(body)
    });

    const responseText = await upstreamResponse.text();

    if (!upstreamResponse.ok) {
      return new Response(responseText, {
        status: upstreamResponse.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(responseText, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: 'Proxy Internal Error', details: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
