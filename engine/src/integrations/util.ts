// Small helpers shared by the integration modules.
export const deepFind = (obj: unknown, keys: string[], depth = 0): string | null => {
  if (obj === null || typeof obj !== "object" || depth > 6) return null;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) if (typeof rec[k] === "string" && rec[k]) return rec[k] as string;
  for (const v of Array.isArray(obj) ? obj : Object.values(rec)) {
    const hit = deepFind(v, keys, depth + 1);
    if (hit) return hit;
  }
  return null;
};

/** Composio tool data is typed as a string in its docs but arrives as an object (or a JSON string). */
export const asObject = (data: unknown): unknown => {
  if (typeof data !== "string") return data;
  try { return JSON.parse(data); } catch { return data; }
};

export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function hmacBase64(secretBytes: Uint8Array, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  let s = "";
  for (const b of sig) s += String.fromCharCode(b);
  return btoa(s);
}
export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** AES-GCM seal for tokens kept in D1 (the Slack bot token). Key = SHA-256 of a server secret, so a database leak alone is not enough. */
async function aesKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`probity-seal:${secret}`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function seal(secret: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), new TextEncoder().encode(plain)));
  const all = new Uint8Array(iv.length + ct.length);
  all.set(iv); all.set(ct, iv.length);
  let s = "";
  for (const b of all) s += String.fromCharCode(b);
  return btoa(s);
}
export async function unseal(secret: string, sealed: string): Promise<string | null> {
  try {
    const all = b64ToBytes(sealed);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, await aesKey(secret), all.slice(12));
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}
