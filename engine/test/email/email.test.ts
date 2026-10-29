import { afterEach, describe, expect, it, vi } from "vitest";
import { holdAlertEmail, preRunSummaryEmail, sendEmail, signInCodeEmail } from "../../src/email";
import { makeTestEnv } from "../auth/helpers";

afterEach(() => vi.unstubAllGlobals());

describe("sendEmail", () => {
  it("writes to the outbox and reports not delivered when no sending domain is configured", async () => {
    const env = makeTestEnv({ RESEND_API_KEY: "re_test" });
    const r = await sendEmail(env, { to: ["ap@acmefreight.example", "cfo@acmefreight.example"], subject: "Hello", text: "Body" });
    expect(r).toEqual({ ok: true, delivered: false });
    const rows = await env.DB.prepare("SELECT to_addr, status FROM email_outbox ORDER BY id").all();
    expect(rows.results).toEqual([{ to_addr: "ap@acmefreight.example", status: "outbox" }, { to_addr: "cfo@acmefreight.example", status: "outbox" }]);
  });
  it("posts to Resend with the sender, key and recipients", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => { seen.push({ url, init }); return Response.json({ id: "em_123" }); });
    const env = makeTestEnv({ RESEND_API_KEY: "re_test", EMAIL_FROM: "Probity <alerts@probity.example>" });
    const r = await sendEmail(env, { to: "ap@acmefreight.example", subject: "Hold", text: "T", html: "<p>T</p>" });
    expect(r).toEqual({ ok: true, delivered: true, id: "em_123" });
    expect(seen[0]!.url).toBe("https://api.resend.com/emails");
    expect((seen[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual({ from: "Probity <alerts@probity.example>", to: ["ap@acmefreight.example"], subject: "Hold", text: "T", html: "<p>T</p>" });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM email_outbox").first<{ n: number }>())!.n).toBe(0);
  });
  it("keeps a copy and reports failure when Resend refuses or is unreachable", async () => {
    const env = makeTestEnv({ RESEND_API_KEY: "re_test", EMAIL_FROM: "Probity <alerts@probity.example>" });
    vi.stubGlobal("fetch", async () => Response.json({ message: "The domain is not verified." }, { status: 403 }));
    expect(await sendEmail(env, { to: "ap@acmefreight.example", subject: "S", text: "T" })).toEqual({ ok: false, delivered: false, error: "The domain is not verified.", code: "email_failed" });
    vi.stubGlobal("fetch", async () => { throw new Error("down"); });
    expect((await sendEmail(env, { to: "ap@acmefreight.example", subject: "S", text: "T" })).ok).toBe(false);
    const st = await env.DB.prepare("SELECT status FROM email_outbox ORDER BY id").all();
    expect(st.results).toEqual([{ status: "failed_403" }, { status: "failed_network" }]);
  });
  it("a deployed app without a sender returns email_unconfigured and stores nothing", async () => {
    const env = makeTestEnv({ APP_URL: "https://probity.pages.dev", RESEND_API_KEY: "re_test" });
    expect(await sendEmail(env, { to: "ap@acmefreight.example", subject: "S", text: "T" })).toEqual({ ok: false, delivered: false, error: "E-mail sending isn't set up yet.", code: "email_unconfigured" });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM email_outbox").first<{ n: number }>())!.n).toBe(0);
  });
  it("refuses an empty recipient list", async () => {
    expect((await sendEmail(makeTestEnv(), { to: [" "], subject: "S", text: "T" })).ok).toBe(false);
  });
});

describe("templates", () => {
  it("sign-in code", () => {
    const m = signInCodeEmail("482913");
    expect(m.subject).toBe("482913 is your Probity sign-in code");
    expect(m.text).toContain("code is 482913");
  });
  it("hold alert points at the number on file and links to the request", () => {
    const m = holdAlertEmail({ vendor: "Zetaris Holdings", requestId: "BCR-2026-0412", reason: "The new account was first named in an e-mail from a look-alike domain.", callbackPhone: "+1 703 555 0148", amount: "$48,200.00", link: "https://probity.pages.dev/requests/BCR-2026-0412" });
    expect(m.subject).toBe("Hold: Zetaris Holdings asked to change bank details");
    expect(m.text).toContain("+1 703 555 0148");
    expect(m.text).toContain("Do not use the number in the request");
    expect(m.text).toContain("https://probity.pages.dev/requests/BCR-2026-0412");
    expect(holdAlertEmail({ vendor: "V", requestId: "R", reason: "x", callbackPhone: null, link: "https://x" }).text).toContain("No phone number is on file");
  });
  it("pre-run summary reads like a person wrote it and escapes HTML", () => {
    const m = preRunSummaryEmail({ weekday: "Friday", cutoff: "14:00", cleared: 3, onHold: 1, needsCall: 1, link: "https://probity.pages.dev/inbox" });
    expect(m.text).toContain("Friday's run, cut-off 14:00: 3 changes cleared, 1 on hold, 1 needs a call.");
    expect(preRunSummaryEmail({ weekday: "Friday", cutoff: "14:00", cleared: 1, onHold: 0, needsCall: 2, link: "x" }).text).toContain("1 change cleared, 0 on hold, 2 need a call.");
    expect(holdAlertEmail({ vendor: "A & <B>", requestId: "R", reason: "x", callbackPhone: null, link: "https://x" }).html).toContain("A &amp; &lt;B&gt;");
  });
});
