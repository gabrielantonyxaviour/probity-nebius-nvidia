import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { emlFor, intake, pickLetter, type IncomingEmail } from "../src/intake";
import { recordJobSpend } from "../src/ops/spend";
import { makeTenantEnv } from "./db";

let planOk = true;
vi.mock("../src/billing/plans", () => ({ consumeCheck: async () => planOk }));

const pdfBytes = () => new TextEncoder().encode("%PDF-1.4\n%fake letter\n").buffer as ArrayBuffer;
const png = () => {
  const b = new Uint8Array(40);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(b.buffer).setUint32(16, 1200);
  new DataView(b.buffer).setUint32(20, 1600);
  return b.buffer as ArrayBuffer;
};

function setup() {
  const fake = makeTenantEnv({ seed: true });
  const files = new Map<string, unknown>();
  const started: Array<{ id: string; params: Record<string, string> }> = [];
  (fake as unknown as Record<string, unknown>).FILES = { put: async (k: string, v: unknown) => void files.set(k, v), get: async (k: string) => (files.has(k) ? { text: async () => String(files.get(k)) } : null) };
  (fake as unknown as Record<string, unknown>).CHECK = { create: async (o: { id: string; params: Record<string, string> }) => void started.push(o) };
  return { env: fake as unknown as Env, fake, files, started };
}

const mail = (over: Partial<IncomingEmail> = {}): IncomingEmail => ({
  orgId: "org_demo", source: "gmail", messageId: "msg-1", from: '"R. Castellane" <ap@boozallen.example>', replyTo: null, subject: "Updated banking instructions", receivedAt: "2026-10-30T02:00:00Z",
  text: "Hello, please see the attached letter.", headers: { "Authentication-Results": "mx; spf=pass smtp.mailfrom=boozallen.example; dkim=pass header.d=boozallen.example" }, attachments: [{ filename: "letter.pdf", contentType: "application/pdf", bytes: pdfBytes() }], ...over,
});

beforeEach(() => {
  planOk = true;
});

describe("intake", () => {
  it("makes a request from a PDF attachment, matched by the sender's domain, and starts its check", async () => {
    const { env, fake, files, started } = setup();
    const r = await intake(env, mail());
    expect(r).toMatchObject({ status: "started", note: null });
    expect(r.runId).toMatch(/^run-/);
    const row = await fake.DB.prepare("SELECT * FROM requests WHERE id = ?1").bind(r.requestId).first<Record<string, unknown>>();
    expect(row).toMatchObject({ vendor_id: "V-10027", org_id: "org_demo", source: "gmail", message_id: "msg-1", status: "checking", synthetic: 0, kind: "bank_change" });
    expect(String(row!.letter_key)).toMatch(/^orgs\/org_demo\/mail\/GM-20261030-[A-F0-9]{6}\/letter\.pdf$/);
    expect(files.has(String(row!.letter_key))).toBe(true);
    expect(String(files.get(String(row!.eml_key)))).toMatch(/^From: "R\. Castellane" <ap@boozallen\.example>\nSubject: Updated banking instructions/);
    expect(started).toHaveLength(1);
    expect(started[0]!.params).toMatchObject({ runId: r.runId, orgId: "org_demo" });
    expect(started[0]!.params.sessionId).toBe(`intake:${r.requestId}`);
    const run = await fake.DB.prepare("SELECT org_id, live FROM runs WHERE id = ?1").bind(r.runId).first();
    expect(run).toEqual({ org_id: "org_demo", live: 1 });
    expect(JSON.parse(String(row!.json)).email).toMatchObject({ spf: "pass", dkim: "pass", subject: "Updated banking instructions" });
  });

  it("is idempotent by message id", async () => {
    const { env, started } = setup();
    const a = await intake(env, mail());
    const b = await intake(env, mail());
    expect(b).toMatchObject({ status: "duplicate", requestId: a.requestId, runId: a.runId });
    expect(started).toHaveLength(1);
  });

  it("treats the e-mail body as the letter when nothing is attached", async () => {
    const { env, fake, files } = setup();
    const r = await intake(env, mail({ messageId: "msg-2", attachments: [], text: "Please pay to routing 110000000, account 000999000141." }));
    expect(r.status).toBe("started");
    const row = await fake.DB.prepare("SELECT letter_key, json FROM requests WHERE id = ?1").bind(r.requestId).first<{ letter_key: string; json: string }>();
    expect(row!.letter_key.endsWith("/letter.txt")).toBe(true);
    expect(JSON.parse(row!.json).letter).toBe("body");
    expect(new TextDecoder().decode(files.get(row!.letter_key) as Uint8Array)).toContain("000999000141");
  });

  it("takes a picture when there is no PDF, and ignores files that only claim to be PDFs", async () => {
    const { env, fake } = setup();
    const fakePdf = { filename: "x.pdf", contentType: "application/pdf", bytes: new TextEncoder().encode("not a pdf").buffer as ArrayBuffer };
    const r = await intake(env, mail({ messageId: "msg-3", attachments: [fakePdf, { filename: "photo.png", contentType: "image/png", bytes: png() }] }));
    const row = await fake.DB.prepare("SELECT letter_key FROM requests WHERE id = ?1").bind(r.requestId).first<{ letter_key: string }>();
    expect(row!.letter_key.endsWith("/letter.png")).toBe(true);
    expect(pickLetter([fakePdf])).toBeNull();
    expect(pickLetter([{ filename: "big.pdf", contentType: "application/pdf", bytes: new ArrayBuffer(11 * 1024 * 1024) }])).toBeNull();
  });

  it("keeps a request it cannot match to a vendor, says why, and does not spend a check", async () => {
    const { env, fake, started } = setup();
    const r = await intake(env, mail({ messageId: "msg-4", from: "Finance <pay@totally-new.example>", subject: "New bank", attachments: [] }));
    expect(r).toMatchObject({ status: "unchecked", runId: null });
    expect(r.note).toMatch(/No vendor of record matches this e-mail \(sender totally-new\.example\)/);
    expect(started).toHaveLength(0);
    const row = await fake.DB.prepare("SELECT vendor_id, status, note FROM requests WHERE id = ?1").bind(r.requestId).first<{ vendor_id: string; status: string; note: string }>();
    expect(row).toMatchObject({ vendor_id: "unmatched_org_demo", status: "unchecked" });
    expect((await fake.DB.prepare("SELECT n FROM usage WHERE kind = 'live_check' AND session_id = '*'").first())).toBeNull();
  });

  it("matches by name when the domain is unknown", async () => {
    const { env, fake } = setup();
    const r = await intake(env, mail({ messageId: "msg-5", from: '"Treasury" <treasury@gmail.example>', subject: "L3Harris Technologies bank account change", attachments: [] }));
    const row = await fake.DB.prepare("SELECT vendor_id FROM requests WHERE id = ?1").bind(r.requestId).first<{ vendor_id: string }>();
    expect(row!.vendor_id).toBe("V-10198");
  });

  it("is scoped to the company: another company's vendors never match", async () => {
    const { env } = setup();
    const r = await intake(env, mail({ orgId: "org_acme", messageId: "msg-6" }));
    expect(r.status).toBe("unchecked");
    expect(r.note).toMatch(/No vendor of record/);
  });

  it("leaves a matched request unchecked, with a plain note, when the plan or the budget has no checks left", async () => {
    const { env, fake, started } = setup();
    fake.d1.exec("INSERT INTO vendors (vendor_id, legal_name, legal_name_norm, is_fictional, status, created_at, org_id) VALUES ('xero_1', 'Acme Freight Ltd', 'ACME FREIGHT LTD', 0, 'active', 'x', 'org_acme'); INSERT INTO vendor_domains VALUES ('xero_1', 'acmefreight.example', 'x');");
    planOk = false;
    const a = await intake(env, mail({ orgId: "org_acme", messageId: "msg-7", from: "ar@acmefreight.example" }));
    expect(a).toMatchObject({ status: "unchecked" });
    expect(a.note).toMatch(/used its checks for the month/);
    planOk = true;
    await recordJobSpend(env, 7, "test");
    const b = await intake(env, mail({ orgId: "org_acme", messageId: "msg-8", from: "ar@acmefreight.example" }));
    expect(b.note).toMatch(/switched off/);
    expect(started).toHaveLength(0);
  });
});

describe("intake helpers", () => {
  it("builds a header block the pipeline can read", () => {
    const eml = emlFor(mail({ replyTo: "boss@x.example" }));
    expect(eml.split("\n\n")[0]).toContain("Reply-To: boss@x.example");
    expect(eml.split("\n\n")[0]).toContain("Authentication-Results: mx; spf=pass");
  });
});
