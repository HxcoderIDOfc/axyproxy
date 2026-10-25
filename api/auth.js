import { get } from '@vercel/global-config';

// Menggunakan environment variable untuk token rahasia
const BUATQRIS_SECRET = process.env.BUATQRIS_SECRET_TOKEN || process.env.NINEROUTER_KEY || "axy-signature-salt-2026";

export async function signApiKey(plan = "starter", secret = BUATQRIS_SECRET) {
  const timestamp = Date.now();
  const rand = Math.random().toString(36).substring(2, 7);
  const payload = `axy-live-${plan}-${rand}-${timestamp}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(payload + ':' + secret);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const signature = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
  return `${payload}-${signature}`;
}

export async function verifyApiKey(clientApiKey) {
  if (!clientApiKey || typeof clientApiKey !== 'string') return null;
  const key = clientApiKey.trim();

  // 1. Static Master Test Key
  if (key === 'axy-key-tes123') {
    return { active: true, plan: 'test', quota: 999999, owner: 'developer' };
  }

  // 2. Cryptographically signed dynamic keys (dari pembelian QRIS)
  if (key.startsWith('axy-live-')) {
    const parts = key.split('-');
    if (parts.length >= 6) {
      const providedHash = parts[parts.length - 1];
      const payload = parts.slice(0, -1).join('-');
      const encoder = new TextEncoder();
      const data = encoder.encode(payload + ':' + BUATQRIS_SECRET);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const expectedHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);

      if (providedHash === expectedHash) {
        return {
          active: true,
          plan: parts[2] || 'standard',
          owner: 'qris_customer',
          created_at: Number(parts[4]) || Date.now()
        };
      }
    }
  }

  // 3. Fallback: Edge Config lookup
  try {
    const keyData = await get(key);
    if (keyData !== undefined && keyData !== null && keyData !== false) {
      if (typeof keyData === 'object') return keyData;
      return { active: true, plan: 'custom', owner: String(keyData) };
    }
  } catch (e) {
    // Edge Config lookup failed or not set
  }

  return null;
}
