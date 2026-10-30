import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { setResolved, type Role } from "../src/auth/guards";
import { sha256Hex } from "../src/integrations/util";
import { vendorRoutes } from "../src/routes/vendors";
import type { AppEnv } from "../src/routes/util";
import type { Env } from "../src/env";
import { makeEnv } from "./integrations/harness";

const env = makeEnv({ seed: true });
const E = env as unknown as Env;
const sql = (q: string, ...a: unknown[]) => env.d1.prepare(q).bind(...a);

/** The vendor routes as org X's signed-in user (or a viewer) would reach them. */
function as(orgId: string, role: Role = "owner") {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    const signedIn = role !== "viewer";
    setResolved(c, { user: signedIn ? { id: "u1", email: "o@x.test", name: null } : null, orgId, role, sessionId: null });
    c.set("orgId", orgId); c.set("userId", signedIn ? "u1" : null); c.set("sid", "s");
    await next();
  });
  app.route("/", vendorRoutes);
  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.request(path, { method, headers: typeof body === "string" ? headers : body === undefined ? headers : { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) }, E);
  return {
    call,
    list: async () => (await (await call("GET", "/api/vendors")).json()) as Array<Record<string, any>>,
    add: (body: unknown) => call("POST", "/api/vendors", body),
    csv: (text: string) => call("POST", "/api/vendors/import", text, { "content-type": "text/csv" }),
  };
}
const A = "org_alpha";
const B = "org_bravo";
const ACME = { legalName: "Acme Supply LLC", domains: ["Acme-Supply.COM"], phone: "(757) 555-0190", bank: { bankName: "Calderwick Savings Bank", routing: "110000000", account: "000012345678" } };

describe("GET /api/vendors", () => {
  it("lists a new company as empty, and the demo company's vendors with their source", async () => {
    expect(await as(A).list()).toEqual([]);
    const demo = await as("org_demo", "viewer").list();
    expect(demo.length).toBeGreaterThan(20);
    expect(demo.every((v) => v.source === "sample")).toBe(true);
    expect(demo.some((v) => v.legalName === "Sable Harbor Marine Logistics LLC")).toBe(true);
    expect(demo.some((v) => /unknown sender/i.test(v.legalName))).toBe(false);
    const sable = demo.find((v) => v.id === "V-10561")!;
    expect(sable).toMatchObject({ phone: "(757) 555-0190", bank: { bankName: "Calderwick Savings Bank", last4: "0768" } });
    expect(sable.domains).toContain("sableharbor.example");
    expect(demo.find((v) => v.id === "V-07734")).toBeUndefined(); // merged
  });
});

describe("POST /api/vendors", () => {
  it("adds a vendor, lowercases domains and never returns or stores a full account number", async () => {
    const a = as(A);
    const r = await a.add(ACME);
    expect(r.status).toBe(201);
    const v = (await r.json()) as Record<string, any>;
    expect(v).toMatchObject({ legalName: "Acme Supply LLC", source: "manual", status: "active", domains: ["acme-supply.com"], phone: "(757) 555-0190", bank: { bankName: "Calderwick Savings Bank", last4: "5678" } });
    expect(JSON.stringify(v)).not.toContain("12345678");
    expect(JSON.stringify(await a.list())).not.toContain("000012345678");
    const row = await sql("SELECT * FROM vendor_bank_accounts WHERE vendor_id = ?1", v.id).first<Record<string, string>>();
    expect(row).toMatchObject({ routing: "110000000", account_last4: "5678", status: "active", account_hash: await sha256Hex("110000000:000012345678") });
    expect(JSON.stringify(await env.d1.prepare("SELECT * FROM vendor_bank_accounts WHERE vendor_id = ?1").bind(v.id).all())).not.toContain("12345678\"");
    expect(await sql("SELECT org_id, source FROM vendors WHERE vendor_id = ?1", v.id).first()).toEqual({ org_id: A, source: "manual" });
    expect(await sql("SELECT value, changed_via FROM vendor_contacts WHERE vendor_id = ?1 AND kind = 'phone' AND valid_to IS NULL", v.id).first()).toEqual({ value: "(757) 555-0190", changed_via: "manual" });
  });
  it("accepts a vendor with only a name, or only the last 4 of the account", async () => {
    const a = as("org_min");
    expect((await a.add({ legalName: "Plain Co" })).status).toBe(201);
    const r = await a.add({ legalName: "Last Four Co", bank: { bankName: "Harbor Bank", routing: "110000000", accountLast4: "4321" } });
    expect(((await r.json()) as any).bank).toEqual({ bankName: "Harbor Bank", last4: "4321" });
  });
  it("rejects a duplicate legal name in the same company only", async () => {
    const r = await as(A).add({ legalName: "ACME  supply, llc" });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: expect.any(String), code: "duplicate" });
    expect((await as(B).add({ legalName: "Acme Supply LLC" })).status).toBe(201);
  });
  it.each([
    ["no name", {}],
    ["short name", { legalName: "A" }],
    ["bad domain", { legalName: "Zed Co", domains: ["not a domain"] }],
    ["a url", { legalName: "Zed Co", domains: ["https://zed.com/x"] }],
    ["six domains", { legalName: "Zed Co", domains: ["a.com", "b.com", "c.com", "d.com", "e.com", "f.com"] }],
    ["bad phone", { legalName: "Zed Co", phone: "call me" }],
    ["8-digit routing", { legalName: "Zed Co", bank: { bankName: "Bank", routing: "11000000", accountLast4: "1234" } }],
    ["bank without account", { legalName: "Zed Co", bank: { bankName: "Bank", routing: "110000000" } }],
    ["3-digit last4", { legalName: "Zed Co", bank: { bankName: "Bank", routing: "110000000", accountLast4: "123" } }],
  ])("rejects %s with 400 { error, code }", async (_n, body) => {
    const r = await as("org_val").add(body);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: expect.any(String), code: "invalid" });
  });
  it("rejects a body that is not JSON", async () => {
    expect((await as("org_val").call("POST", "/api/vendors", "nope", { "content-type": "application/json" })).status).toBe(400);
  });
  it("is for admins and owners of a real company", async () => {
    for (const [org, role] of [["org_demo", "owner"], [A, "viewer"], [A, "member"]] as const) {
      const r = await as(org, role).add({ legalName: "Nope Co" });
      expect([401, 403]).toContain(r.status);
      expect(((await r.json()) as any).code).toBeTruthy();
    }
    expect((await as(A, "admin").add({ legalName: "Admin Added Co" })).status).toBe(201);
    expect((await as(A, "member").call("POST", "/api/vendors/samples")).status).toBe(403);
    expect((await as(A, "member").csv("name\nX Y")).status).toBe(403);
    expect((await as(A, "member").call("DELETE", "/api/vendors/anything")).status).toBe(403);
  });
});

describe("POST /api/vendors/import", () => {
  const C = "org_csv";
  it("adds good rows and reports the rest by row", async () => {
    const text = 'name,domain,phone,bank_name,routing,account\r\n"Birch & Sons, Inc.","birch.com;birchsons.com",555 010 0199,"Lakeside, N.A.",110000000,"9876 5432 1098"\r\nCedar Freight,cedar.example,,,,\r\n,nodomain.com,,,,\r\nCedar Freight LLC,,,,,\r\nDelta Parts,delta.example,,Bank,12345,1234\r\n\r\n';
    const r = await as(C).csv(text);
    expect(r.status).toBe(200);
    const out = (await r.json()) as { added: number; skipped: Array<{ row: number; reason: string }> };
    expect(out.added).toBe(2);
    expect(out.skipped).toEqual([
      { row: 4, reason: "name: The legal name needs at least 2 characters." },
      { row: 5, reason: "Same vendor as row 3." },
      { row: 6, reason: "routing: The routing number is 9 digits." },
    ]);
    const list = await as(C).list();
    expect(list.map((v) => v.legalName)).toEqual(["Birch & Sons, Inc.", "Cedar Freight"]);
    expect(list[0]).toMatchObject({ domains: ["birch.com", "birchsons.com"], phone: "555 010 0199", bank: { bankName: "Lakeside, N.A.", last4: "1098" } });
    expect(JSON.stringify(list)).not.toContain("9876");
  });
  it("skips vendors already in the list, so importing twice adds nothing", async () => {
    const r = (await (await as(C).csv("name\nBirch & Sons Inc\nCedar Freight\nNew One LLC")).json()) as any;
    expect(r.added).toBe(1);
    expect(r.skipped.map((s: any) => s.row)).toEqual([2, 3]);
    expect(r.skipped[0].reason).toBe("Already in your vendor list.");
  });
  it("accepts JSON { csv } and reads only its own company", async () => {
    const r = await as("org_csv2").call("POST", "/api/vendors/import", { csv: "Vendor,Email domain\nOnly Mine LLC,ap@only.example" });
    expect((await r.json()) as any).toEqual({ added: 1, skipped: [] });
    expect((await as(C).list()).some((v) => v.legalName === "Only Mine LLC")).toBe(false);
    expect((await as("org_csv2").list())[0]!.domains).toEqual(["only.example"]);
  });
  it("refuses bad input with { error, code }", async () => {
    const a = as("org_csv3");
    const cases: Array<[Response | Promise<Response>, number, string]> = [
      [a.csv(""), 400, "bad_csv"],
      [a.csv("domain,phone\nacme.com,1"), 400, "bad_csv"],
      [a.csv(`name\n${Array.from({ length: 501 }, (_, i) => `V ${i} Co`).join("\n")}`), 422, "too_many_rows"],
      [a.csv(`name\n${"x".repeat(201 * 1024)}`), 413, "too_large"],
      [a.call("POST", "/api/vendors/import", { csv: 5 }), 400, "bad_request"],
    ];
    for (const [p, status, code] of cases) {
      const r = await p;
      expect(r.status).toBe(status);
      expect(await r.json()).toEqual({ error: expect.any(String), code });
    }
    expect(await a.list()).toEqual([]);
  });
  it("takes exactly 500 rows", async () => {
    const r = (await (await as("org_500").csv(`name\n${Array.from({ length: 500 }, (_, i) => `Vendor Number ${i} Ltd`).join("\n")}`)).json()) as any;
    expect(r.added).toBe(500);
    expect((await as("org_500").list()).length).toBe(500);
  });
});

describe("POST /api/vendors/samples", () => {
  const S = "org_sample";
  const count = (t: string, col = "vendor_id") => sql(`SELECT COUNT(*) AS n FROM ${t} WHERE ${col} LIKE 'smp_%'`).first<{ n: number }>().then((r) => r!.n);
  it("copies the demo company's active vendors with their records, then adds nothing the second time", async () => {
    await as(S).add({ legalName: "Kettle Point Data Cabling LLC" }); // already there under that name: not copied
    const first = (await (await as(S).call("POST", "/api/vendors/samples")).json()) as any;
    expect(first.added).toBeGreaterThan(20);
    expect(first.skipped).toBe(1);
    const list = await as(S).list();
    const samples = list.filter((v) => v.source === "sample");
    expect(samples.length).toBe(first.added);
    expect(list.find((v) => v.legalName === "Kettle Point Data Cabling LLC")!.source).toBe("manual");
    const sable = samples.find((v) => v.legalName.startsWith("Sable Harbor"))!;
    expect(sable.id).toMatch(/^smp_[0-9a-f]{10}_V-10561$/);
    expect(sable).toMatchObject({ phone: "(757) 555-0190", bank: { bankName: "Calderwick Savings Bank", last4: "0768" }, status: "active" });
    expect(sable.domains.sort()).toEqual(["sableharbor.example", "sableharborship.example"]);
    // Everything hangs off the prefixed id; nothing is shared with the demo company.
    const inv = await sql("SELECT COUNT(*) AS n FROM ap_invoices WHERE vendor_id = ?1", sable.id).first<{ n: number }>();
    expect(inv!.n).toBe(6);
    expect((await sql("SELECT COUNT(*) AS n FROM vendor_remit_history WHERE vendor_id = ?1", sable.id).first<{ n: number }>())!.n).toBe(1);
    expect((await sql("SELECT COUNT(*) AS n FROM vendor_contacts WHERE vendor_id = ?1", sable.id).first<{ n: number }>())!.n).toBe(3);
    expect(await count("payment_run_items")).toBeGreaterThan(0);
    expect(await sql("SELECT 1 FROM payment_run_items WHERE vendor_id LIKE 'smp_%' AND bank_account_id NOT IN (SELECT bank_account_id FROM vendor_bank_accounts)").first()).toBeNull();
    expect((await sql("SELECT COUNT(*) AS n FROM vendors WHERE org_id = 'org_demo'").first<{ n: number }>())!.n).toBe(40);
    expect(list.some((v) => ["V-10154", "V-07734"].some((x) => v.id.endsWith(x)))).toBe(false); // inactive and merged vendors stay behind
    const before = await sql("SELECT (SELECT COUNT(*) FROM vendors) a, (SELECT COUNT(*) FROM vendor_bank_accounts) b, (SELECT COUNT(*) FROM ap_invoices) c, (SELECT COUNT(*) FROM payment_run_items) d").first();
    expect(await (await as(S).call("POST", "/api/vendors/samples")).json()).toEqual({ added: 0, skipped: first.added + 1 });
    expect(await sql("SELECT (SELECT COUNT(*) FROM vendors) a, (SELECT COUNT(*) FROM vendor_bank_accounts) b, (SELECT COUNT(*) FROM ap_invoices) c, (SELECT COUNT(*) FROM payment_run_items) d").first()).toEqual(before);
  });
  it("gives each company its own ids and keeps the companies apart", async () => {
    const other = (await (await as("org_sample2").call("POST", "/api/vendors/samples")).json()) as any;
    expect(other.added).toBeGreaterThan(20);
    const ids1 = new Set((await as(S).list()).map((v) => v.id));
    const ids2 = (await as("org_sample2").list()).map((v) => v.id);
    expect(ids2.some((id) => ids1.has(id))).toBe(false);
    expect((await sql("SELECT COUNT(DISTINCT org_id) AS n FROM vendors WHERE vendor_id LIKE 'smp_%'").first<{ n: number }>())!.n).toBe(2);
  });
  it("is refused for the demo company", async () => {
    expect((await as("org_demo").call("POST", "/api/vendors/samples")).status).toBe(403);
  });
});

describe("DELETE /api/vendors/:id", () => {
  it("removes a manual vendor and everything on file for it", async () => {
    const a = as("org_del");
    const v = (await (await a.add(ACME)).json()) as any;
    const r = await a.call("DELETE", `/api/vendors/${v.id}`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(await a.list()).toEqual([]);
    for (const t of ["vendor_domains", "vendor_contacts", "vendor_bank_accounts"]) expect(await sql(`SELECT 1 FROM ${t} WHERE vendor_id = ?1`, v.id).first()).toBeNull();
    expect((await a.call("DELETE", `/api/vendors/${v.id}`)).status).toBe(404);
  });
  it("removes a sample vendor with its invoices, leaving the rest of the copy", async () => {
    const a = as("org_del2");
    await a.call("POST", "/api/vendors/samples");
    const list = await a.list();
    const sable = list.find((v) => v.legalName.startsWith("Sable Harbor"))!;
    expect((await a.call("DELETE", `/api/vendors/${sable.id}`)).status).toBe(200);
    expect((await a.list()).length).toBe(list.length - 1);
    expect(await sql("SELECT 1 FROM ap_invoices WHERE vendor_id = ?1", sable.id).first()).toBeNull();
    expect(await sql("SELECT 1 FROM vendors WHERE vendor_id = 'V-10561'").first()).not.toBeNull();
  });
  it("refuses Xero vendors (409 xero_managed) and vendors with checks on file (409 in_use)", async () => {
    await sql("INSERT INTO vendors (vendor_id, legal_name, legal_name_norm, is_fictional, status, created_at, org_id, source) VALUES ('xero_c-1','From Xero Ltd','FROM XERO LTD',0,'active','x','org_del3','xero')").run();
    const a = as("org_del3");
    const x = await a.call("DELETE", "/api/vendors/xero_c-1");
    expect(x.status).toBe(409);
    expect(await x.json()).toEqual({ error: expect.any(String), code: "xero_managed" });
    const v = (await (await a.add({ legalName: "Has Checks Co" })).json()) as any;
    await sql("INSERT INTO requests (id, vendor_id, kind, received_at, sender_email, amount_cents, status, synthetic, letter_key, json, org_id, source) VALUES ('REQ-DEL-1', ?1, 'bank_change', 'x', 'a@b.c', 1, 'checked', 0, 'k', '{}', 'org_del3', 'upload')", v.id).run();
    const u = await a.call("DELETE", `/api/vendors/${v.id}`);
    expect(u.status).toBe(409);
    expect(((await u.json()) as any).code).toBe("in_use");
    expect((await a.list()).length).toBe(2);
  });
  it("rejects a malformed id", async () => {
    expect((await as(A).call("DELETE", "/api/vendors/a%20b")).status).toBe(400);
  });
});

describe("tenant isolation", () => {
  it("one company never lists, deletes or sees another company's vendors", async () => {
    const a = as("org_iso_a");
    const b = as("org_iso_b");
    const va = (await (await a.add({ legalName: "Alpha Only Supply Co", domains: ["alpha-only.com"], phone: "(555) 010-0100", bank: { bankName: "Alpha Bank", routing: "110000000", account: "5550001234" } })).json()) as any;
    await b.add({ legalName: "Bravo Only Supply Co" });
    expect((await b.list()).map((v) => v.legalName)).toEqual(["Bravo Only Supply Co"]);
    expect((await a.list()).map((v) => v.legalName)).toEqual(["Alpha Only Supply Co"]);
    expect(JSON.stringify(await b.list())).not.toMatch(/alpha/i);
    const r = await b.call("DELETE", `/api/vendors/${va.id}`);
    expect(r.status).toBe(404);
    expect(await sql("SELECT org_id FROM vendors WHERE vendor_id = ?1", va.id).first()).toEqual({ org_id: "org_iso_a" });
    expect(await sql("SELECT 1 FROM vendor_bank_accounts WHERE vendor_id = ?1", va.id).first()).not.toBeNull();
    expect(await sql("SELECT 1 FROM vendor_domains WHERE vendor_id = ?1", va.id).first()).not.toBeNull();
    expect((await as("org_demo", "viewer").call("DELETE", `/api/vendors/${va.id}`)).status).toBe(403);
    expect((await as("org_demo", "viewer").list()).some((v) => v.id === va.id)).toBe(false);
    // Deleting a demo vendor from a real company does nothing either.
    expect((await b.call("DELETE", "/api/vendors/V-10561")).status).toBe(404);
    expect(await sql("SELECT 1 FROM vendors WHERE vendor_id = 'V-10561'").first()).not.toBeNull();
    // Another company's domain is not visible through ours: the same vendor name and domain can exist in both.
    expect((await b.add({ legalName: "Alpha Only Supply Co", domains: ["alpha-only.com"] })).status).toBe(201);
  });
});

describe("ledger account lookup stays inside the company", () => {
  it("an account on another company's vendor is not reported as 'also on another vendor'", async () => {
    const { ledgerEvidence } = await import("../src/check/ledger");
    const hash = await sha256Hex("110000000:777700001111");
    const mk = (id: string, org: string, name: string) => [
      sql("INSERT INTO vendors (vendor_id, legal_name, legal_name_norm, is_fictional, status, created_at, org_id) VALUES (?1,?2,?2,0,'active','x',?3)", id, name, org).run(),
      sql("INSERT INTO vendor_bank_accounts (bank_account_id, vendor_id, bank_name, routing, account_last4, account_hash, status, changed_at) VALUES (?1,?2,'Bank','110000000','1111',?3,'active','2026-01-01T00:00:00Z')", `ba_${id}`, id, hash).run(),
    ];
    await Promise.all([...mk("lv_mine", "org_led_a", "Mine Co"), ...mk("lv_theirs", "org_led_b", "Theirs Secret Co"), ...mk("lv_mine2", "org_led_a", "Mine Two Co")]);
    const s = { request: { vendorId: "lv_mine", receivedAt: "2026-10-30T00:00:00Z" }, textAccount: { hash, digitsHash: "d", last4: "1111" }, letterPhones: [] } as never;
    const out = JSON.stringify(await ledgerEvidence(E, s));
    expect(out).toContain("Mine Two Co");
    expect(out).not.toContain("Theirs Secret Co");
  });
});
