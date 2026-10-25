import { signApiKey } from '../auth.js';

export const config = {
  runtime: 'edge',
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
};

const DEFAULT_ACC = atob('dXNlcl82YTlhYjUyOTE3MDdhOC44MzY3NjI2Ng==');
const DEFAULT_SEC = atob('c2tfbGl2ZV9iNjAwMGM2YWFmZDdhMGE0NjJiZTMxMmU3NjFlNjRkNTg0NjYxZjVhMzI5NDI1MTI1NTgzODVhMGI5MzE2ODM2');

const ACCOUNT_ID = process.env.BUATQRIS_ACCOUNT_ID || DEFAULT_ACC;
const SECRET_TOKEN = process.env.BUATQRIS_SECRET_TOKEN || DEFAULT_SEC;

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const url = new URL(req.url);
  let transactionId = url.searchParams.get('transaction_id');
  let plan = url.searchParams.get('plan') || 'starter';

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    if (body.transaction_id) transactionId = body.transaction_id;
    if (body.plan) plan = body.plan;
  }

  if (!transactionId) {
    return new Response(JSON.stringify({ error: 'Parameter transaction_id wajib diisi' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const params = new URLSearchParams({
      action: "api_check_status",
      account_id: ACCOUNT_ID,
      secret_token: SECRET_TOKEN,
      transaction_id: String(transactionId)
    });

    const response = await fetch("https://api.buatqris.site", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });

    const result = await response.json().catch(() => null);

    if (!result) {
      return new Response(JSON.stringify({ error: 'Gagal memverifikasi status dari gateway' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Periksa status transaksi: success, paid, pending, expired, failed
    const trxData = result.data || {};
    const status = (trxData.status || result.status || 'pending').toLowerCase();
    const isPaid = status === 'success' || status === 'paid';

    if (isPaid) {
      // Buat API Key baru yang ditandatangani secara kriptografis
      const apiKey = await signApiKey(plan);

      return new Response(JSON.stringify({
        success: true,
        paid: true,
        status: 'success',
        transaction_id: transactionId,
        amount: trxData.amount || trxData.total_amount,
        api_key: apiKey,
        plan: plan,
        message: 'Pembayaran berhasil dikonfirmasi! API Key Anda siap digunakan.'
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      paid: false,
      status: status,
      transaction_id: transactionId,
      message: status === 'pending' ? 'Menunggu pembayaran via QRIS...' : `Status transaksi: ${status}`
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
