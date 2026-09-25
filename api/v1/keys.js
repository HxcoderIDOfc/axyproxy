import { get } from '@vercel/global-config';

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const apiKey = url.searchParams.get('key');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Parameter ?key= wajib diisi' }), { status: 400 });
    }

    try {
      const keyData = await get(apiKey);
      if (!keyData) {
        return new Response(JSON.stringify({ error: 'API Key tidak ditemukan di Global Config' }), { status: 404 });
      }

      return new Response(JSON.stringify({ success: true, data: keyData }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed. Penambahan key dilakukan via Vercel Dashboard.' }), { status: 405 });
}
