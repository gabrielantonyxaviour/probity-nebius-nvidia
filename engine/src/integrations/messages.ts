// Turn a Composio trigger payload into the facts we need, and fetch the full message and its attachments through Composio tools.
import type { IncomingEmail } from "../intake";
import { executeTool } from "./composio";
import type { IntEnv } from "./env";
import { asObject, b64ToBytes, deepFind } from "./util";

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v !== null && typeof v === "object" ? (v as Rec) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export type Attachment = { id: string; filename: string; contentType: string };
export type Parsed = { messageId: string; from: string; subject: string; text: string; receivedAt: string; attachments: Attachment[]; headers: Record<string, string> };

function headerMap(list: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of arr(list)) {
    const { name, value } = rec(h);
    if (typeof name === "string" && typeof value === "string" && /^(authentication-results|received-spf|reply-to|from|return-path|dkim-signature|message-id|x-.*)$/i.test(name)) out[name] = value.slice(0, 600);
  }
  return out;
}
const addrOf = (v: unknown): string => {
  const e = rec(rec(v).emailAddress);
  return str(e.address) ? (str(e.name) ? `"${str(e.name)}" <${str(e.address)}>` : str(e.address)) : str(v);
};

/** Reads the trigger's data block (Gmail: flat fields; Outlook: `outlook_message`). Fields are read leniently: the payload may be partial. */
export function parseTriggerData(source: "gmail" | "outlook", data: unknown): Parsed {
  const d = rec(asObject(data));
  if (source === "gmail") {
    const payload = rec(d.payload);
    return {
      messageId: str(d.message_id) || str(d.id),
      from: str(d.sender) || str(d.from),
      subject: str(d.subject),
      text: str(d.message_text) || str(d.preview) || str(d.body),
      receivedAt: str(d.message_timestamp) || new Date().toISOString(),
      attachments: arr(d.attachment_list).map((a) => ({ id: str(rec(a).attachmentId) || str(rec(a).attachment_id) || str(rec(a).id), filename: str(rec(a).filename) || str(rec(a).name) || "attachment", contentType: str(rec(a).mimeType) || str(rec(a).mime_type) || "application/octet-stream" })).filter((a) => a.id),
      headers: headerMap(payload.headers),
    };
  }
  const m = rec(d.outlook_message ?? d);
  return {
    messageId: str(m.id) || str(d.id),
    from: addrOf(m.from) || addrOf(m.sender),
    subject: str(m.subject),
    text: str(rec(m.body).content) || str(m.bodyPreview),
    receivedAt: str(m.receivedDateTime) || new Date().toISOString(),
    attachments: [],
    headers: headerMap(m.internetMessageHeaders),
  };
}

/** Bytes from whatever form a Composio tool returned a file in: inline base64, or a download URL. */
async function bytesFrom(data: unknown): Promise<ArrayBuffer | null> {
  const url = deepFind(data, ["s3url", "download_url", "downloadUrl", "url"]);
  if (url && /^https:\/\//.test(url)) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (r.ok) return await r.arrayBuffer();
    } catch { /* fall through to inline */ }
  }
  const b64 = deepFind(data, ["contentBytes", "content_bytes", "data", "content", "attachmentData", "file_data"]);
  if (b64 && b64.length > 100 && /^[A-Za-z0-9+/_=-]+$/.test(b64)) {
    const u8 = b64ToBytes(b64);
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
  }
  return null;
}

const MAX_ATTACHMENT = 8 * 1024 * 1024;
const LETTER_TYPES = /pdf|image\/(png|jpe?g)/i;

/** Builds the IncomingEmail Sonnet A's intake takes: full text, headers, and the PDF or image attachments (the letter). */
export async function fetchIncoming(env: IntEnv, p: { orgId: string; source: "gmail" | "outlook"; accountId: string; parsed: Parsed }): Promise<IncomingEmail> {
  const { orgId, source, accountId, parsed } = p;
  let text = parsed.text;
  let headers = parsed.headers;
  let attachments = parsed.attachments;
  if (source === "gmail") {
    const full = await executeTool(env, "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID", orgId, accountId, { message_id: parsed.messageId, format: "full" });
    if (full.successful) {
      const f = asObject(full.data);
      text = deepFind(f, ["messageText", "message_text", "body"]) ?? text;
      const h = rec(rec(f).payload ?? deepFindObj(f, "payload")).headers;
      if (h) headers = { ...headers, ...headerMap(h) };
      const list = deepFindList(f, "attachmentList") ?? deepFindList(f, "attachment_list");
      if (list && attachments.length === 0) attachments = list.map((a) => ({ id: str(rec(a).attachmentId) || str(rec(a).attachment_id), filename: str(rec(a).filename) || "attachment", contentType: str(rec(a).mimeType) || "application/octet-stream" })).filter((a) => a.id);
    }
  } else {
    const full = await executeTool(env, "OUTLOOK_GET_MESSAGE", orgId, accountId, { message_id: parsed.messageId });
    if (full.successful) {
      const m = rec(asObject(full.data));
      const msg = rec(m.response_data ?? m.data ?? m);
      text = str(rec(msg.body).content) || text;
      headers = { ...headers, ...headerMap(msg.internetMessageHeaders) };
    }
    const list = await executeTool(env, "OUTLOOK_LIST_OUTLOOK_ATTACHMENTS", orgId, accountId, { message_id: parsed.messageId });
    const items = list.successful ? deepFindList(asObject(list.data), "value") ?? deepFindList(asObject(list.data), "attachments") ?? [] : [];
    attachments = items.map((a) => ({ id: str(rec(a).id), filename: str(rec(a).name) || "attachment", contentType: str(rec(a).contentType) || "application/octet-stream" })).filter((a) => a.id);
  }
  const files: IncomingEmail["attachments"] = [];
  for (const a of attachments.filter((x) => LETTER_TYPES.test(x.contentType) || /\.(pdf|png|jpe?g)$/i.test(x.filename)).slice(0, 3)) {
    const slug = source === "gmail" ? "GMAIL_GET_ATTACHMENT" : "OUTLOOK_DOWNLOAD_OUTLOOK_ATTACHMENT";
    const args = source === "gmail" ? { message_id: parsed.messageId, attachment_id: a.id, file_name: a.filename } : { message_id: parsed.messageId, attachment_id: a.id, file_name: a.filename };
    const r = await executeTool(env, slug, orgId, accountId, args);
    const bytes = r.successful ? await bytesFrom(asObject(r.data)) : null;
    if (bytes && bytes.byteLength <= MAX_ATTACHMENT) files.push({ filename: a.filename, contentType: a.contentType, bytes });
  }
  const replyTo = headers["Reply-To"] ?? headers["reply-to"] ?? null;
  return { orgId, source, messageId: parsed.messageId, from: parsed.from, replyTo, subject: parsed.subject, receivedAt: parsed.receivedAt, text, headers, attachments: files };
}

function deepFindObj(obj: unknown, key: string, depth = 0): unknown {
  if (obj === null || typeof obj !== "object" || depth > 5) return null;
  const r = obj as Rec;
  if (key in r) return r[key];
  for (const v of Object.values(r)) { const hit = deepFindObj(v, key, depth + 1); if (hit !== null) return hit; }
  return null;
}
const deepFindList = (obj: unknown, key: string): unknown[] | null => {
  const v = deepFindObj(obj, key);
  return Array.isArray(v) ? v : null;
};
