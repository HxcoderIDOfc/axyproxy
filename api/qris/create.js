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

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const amount = parseInt(body.amount, 10) || 10000;
    const plan = (body.plan || 'starter').toLowerCase();
    const customerName = (body.customer_name || 'Developer').trim();

    if (amount < 1000) {
      return new Response(JSON.stringify({ error: 'Nominal minimum adalah Rp 1.000' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const description = `Axynera AI ${plan.toUpperCase()} - ${customerName}`;

    const params = new URLSearchParams({
      action: "api_create_qris",
      account_id: ACCOUNT_ID,
      secret_token: SECRET_TOKEN,
      amount: String(amount),
      description: description,
      qris_method: "qris_two",
      fee_by: "user"
    });

    const response = await fetch("https://api.buatqris.site", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });

    const result = await response.json().catch(() => null);

    if (!result || !result.success || !result.data) {
      return new Response(JSON.stringify({ 
        error: result?.message || 'Gagal menghasilkan tagihan QRIS dari gateway' 
      }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const trxData = result.data;

    return new Response(JSON.stringify({
      success: true,
      data: {
        transaction_id: trxData.transaction_id,
        amount: trxData.amount || amount,
        total_amount: trxData.total_amount || amount,
        qr_url: trxData.qr_url,
        qris_image: trxData.qris_image || trxData.qr_url,
        payment_url: trxData.payment_url,
        plan: plan,
        customer_name: customerName,
        created_at: new Date().toISOString()
      }
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
