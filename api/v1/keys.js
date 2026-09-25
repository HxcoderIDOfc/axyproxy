import { kv } from '@vercel/kv';

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  const url = new URL(req.url);

  // POST: Buat Key Baru
  if (req.method === 'POST') {
    try {
      const { username, quota = 1000 } = await req.json();
      const newApiKey = `axy-key-${Math.random().toString(36).substring(2, 11)}${Date.now().toString(36)}`;

      const keyPayload = {
        username: username || 'guest',
        quota: parseInt(quota),
        active: true,
        created_at: new Date().toISOString()
      };

      await kv.set(`key:${newApiKey}`, keyPayload);

      return new Response(JSON.stringify({ success: true, api_key: newApiKey, data: keyPayload }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }

  // GET: Cek Sisa Kuota Key
  if (req.method === 'GET') {
    const apiKey = url.searchParams.get('key');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Parameter ?key= wajib diisi' }), { status: 400 });
    }

    const keyData = await kv.get(`key:${apiKey}`);
    if (!keyData) {
      return new Response(JSON.stringify({ error: 'API Key tidak ditemukan' }), { status: 404 });
    }

    return new Response(JSON.stringify({ success: true, data: keyData }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
}
