// HMAC-SHA256 request signing shared with job/sweep.py: signature = hex(HMAC(secret, `${ts}.${METHOD}.${path}.${body}`)).
const hex = (b: ArrayBuffer): string => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

async function mac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

export async function signRequest(secret: string, method: string, path: string, body: string, ts = Math.floor(Date.now() / 1000)): Promise<{ timestamp: string; signature: string }> {
  return { timestamp: String(ts), signature: await mac(secret, `${ts}.${method}.${path}.${body}`) };
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** True when the signature matches and the timestamp is within five minutes of now. */
export async function verifyRequest(secret: string | undefined, method: string, path: string, body: string, timestamp: string | undefined, signature: string | undefined, nowSec = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!secret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > 300) return false;
  return safeEqual(await mac(secret, `${timestamp}.${method}.${path}.${body}`), signature.toLowerCase());
}
