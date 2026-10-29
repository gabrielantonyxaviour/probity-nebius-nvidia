import { describe, expect, it } from "vitest";
import { getRequest, listInbox, RequestNotFoundError, vendorMaster } from "../../src/evidence";
import { makeEnv } from "./fake-env";

describe("vendor master and inbox (real migration and seed)", () => {
  const env = makeEnv({ seed: true });

  it("vendorMaster returns the account masked and never a full account number", async () => {
    const r = await vendorMaster(env, { vendorId: "V-10027" });
    const acct = r.evidence.find((e) => e.field === "bank_account");
    expect(acct?.value).toBe("Calderwick Savings Bank ••••0512");
    expect(JSON.stringify(r)).not.toMatch(/\d{9,}/);
    expect(r.evidence.every((e) => e.source === "vendor_master" && e.cached === false)).toBe(true);
    expect(r.evidence.find((e) => e.field === "phone")?.value).toMatch(/555/);
    expect(r.summary.length).toBeLessThanOrEqual(1500);
  });

  it("an unknown vendor is reported, not thrown", async () => {
    const r = await vendorMaster(env, { vendorId: "V-99999" });
    expect(r.evidence).toEqual([]);
    expect(r.summary).toContain("V-99999");
  });

  it("listInbox returns the 16 synthetic requests, soonest payment run first, amounts in cents", async () => {
    const items = await listInbox(env);
    expect(items).toHaveLength(16);
    expect(items.every((i) => i.synthetic && i.status === "unchecked" && i.verdict === null && i.runId === null)).toBe(true);
    const runs = items.map((i) => i.nextRunAt ?? "");
    expect([...runs].sort()).toEqual(runs);
    const booz = items.find((i) => i.requestId === "BCR-2026-0412");
    expect(booz?.amountAtRisk).toEqual({ cents: 128455000, currency: "USD" });
    expect(booz?.vendorName).toBe("Booz Allen Hamilton Inc");
    expect(booz?.nextRunAt).toBe("2026-10-30T18:00:00Z");
  });

  it("getRequest carries the e-mail headers text, the parsed auth results and the vendor on file", async () => {
    const r = await getRequest(env, "BCR-2026-0412");
    expect(r.letterKey).toBe("BCR-2026-0412.letter.pdf");
    expect(r.emlText).toContain("Authentication-Results");
    expect(r.email.spf).toBe("pass");
    expect(r.email.replyTo).toContain("boozallen-payments.example");
    expect(r.vendorOnFile.accountMasked).toBe("••••0512");
    expect(r.vendorOnFile.remitAddress).toContain("McLean");
  });

  it("a mailed request has no e-mail text and an unknown id throws RequestNotFoundError", async () => {
    const r = await getRequest(env, "BCR-2026-0401");
    expect(r.emlText).toBe("");
    expect(r.email.spf).toBeNull();
    await expect(getRequest(env, "BCR-0000")).rejects.toBeInstanceOf(RequestNotFoundError);
  });

  it("reads the latest run's final verdict", async () => {
    const e2 = makeEnv({ seed: true });
    const run = JSON.stringify({ decision: { finalVerdict: "HOLD" } });
    e2.d1.exec(`INSERT INTO runs (id, request_id, status, live, json, created_at, updated_at) VALUES ('run-1','BCR-2026-0412','done',1,'${run}','2026-10-29T00:00:00Z','2026-10-29T00:00:00Z'); UPDATE requests SET latest_run_id='run-1', status='checked' WHERE id='BCR-2026-0412'`);
    const item = (await listInbox(e2)).find((i) => i.requestId === "BCR-2026-0412");
    expect(item?.verdict).toBe("HOLD");
    expect(item?.status).toBe("checked");
  });
});
