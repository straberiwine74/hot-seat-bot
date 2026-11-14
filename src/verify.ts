// Verifies Discord's Ed25519 request signature using WebCrypto (no dependencies).
// Discord rejects your Interactions Endpoint URL unless this works.

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) throw new Error('bad hex');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

let cachedKey: { hex: string; key: CryptoKey } | null = null;

async function getKey(publicKeyHex: string): Promise<CryptoKey> {
  if (cachedKey?.hex === publicKeyHex) return cachedKey.key;
  const key = await crypto.subtle.importKey('raw', hexToBytes(publicKeyHex), { name: 'Ed25519' }, false, ['verify']);
  cachedKey = { hex: publicKeyHex, key };
  return key;
}

export async function verifyDiscordRequest(
  request: Request,
  publicKeyHex: string,
): Promise<{ valid: boolean; body: string }> {
  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');
  const body = await request.text();
  if (!signature || !timestamp) return { valid: false, body };
  try {
    const key = await getKey(publicKeyHex);
    const valid = await crypto.subtle.verify(
      'Ed25519',
      key,
      hexToBytes(signature),
      new TextEncoder().encode(timestamp + body),
    );
    return { valid, body };
  } catch {
    return { valid: false, body };
  }
}
