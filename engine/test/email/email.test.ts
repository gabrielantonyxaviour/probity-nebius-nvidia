import { describe, expect, it } from "vitest";
import { holdAlertEmail, parseFrom, preRunSummaryEmail, sendEmail, signInCodeEmail } from "../../src/email";
import { makeTestEnv } from "../auth/helpers";

type Sent = { from: unknown; to: string[]; subject: string; text: string; html?: string };
function binding(impl?: (m: Sent) => Promise<{ messageId: string }>) {
  const sent: Sent[] = [];
  const EMAIL = { send: async (m: Sent) => { sent.push(m); return impl ? impl(m) : { messageId: "em_123" }; } } as unknown as SendEmail;
  return { EMAIL, sent };
}
const FROM = "Probity <notifications@probity.larinova.com>";

describe("sendEmail", () => {
  it("writes to the outbox and reports not delivered when the binding or sender is missing (local)", async () => {
    const env = makeTestEnv({ EMAIL: binding().EMAIL });
    const r = await sendEmail(env, { to: ["ap@acmefreight.example", "cfo@acmefreight.example"], subject: "Hello", text: "Body" });
    expect(r).toEqual({ ok: true, delivered: false });
    const rows = await env.DB.prepare("SELECT to_addr, status FROM email_outbox ORDER BY id").all();
    expect(rows.results).toEqual([{ to_addr: "ap@acmefreight.example", status: "outbox" }, { to_addr: "cfo@acmefreight.example", status: "outbox" }]);
  });
  it("sends through the Cloudflare binding with a named sender", async () => {
    const b = binding();
    const env = makeTestEnv({ EMAIL: b.EMAIL, EMAIL_FROM: FROM });
    const r = await sendEmail(env, { to: "ap@acmefreight.example", subject: "Hold", text: "T", html: "<p>T</p>" });
    expect(r).toEqual({ ok: true, delivered: true, id: "em_123" });
    expect(b.sent).toEqual([{ from: { name: "Probity", email: "notifications@probity.larinova.com" }, to: ["ap@acmefreight.example"], subject: "Hold", text: "T", html: "<p>T</p>" }]);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM email_outbox").first<{ n: number }>())!.n).toBe(0);
  });
  it("keeps a copy and reports failure when the binding throws", async () => {
    const b = binding(async () => { throw Object.assign(new Error("Sender domain not verified."), { code: "E_SENDER_NOT_VERIFIED" }); });
    const env = makeTestEnv({ EMAIL: b.EMAIL, EMAIL_FROM: FROM });
    expect(await sendEmail(env, { to: "ap@acmefreight.example", subject: "S", text: "T" })).toEqual({ ok: false, delivered: false, error: "Sender domain not verified.", code: "email_failed" });
    expect((await env.DB.prepare("SELECT status FROM email_outbox").all()).results).toEqual([{ status: "failed_e_sender_not_verified" }]);
  });
  it("a deployed app without the binding or sender returns email_unconfigured and stores nothing", async () => {
    for (const over of [{ EMAIL_FROM: FROM }, { EMAIL: binding().EMAIL }, {}]) {
      const env = makeTestEnv({ APP_URL: "https://probity.pages.dev", ...over });
      expect(await sendEmail(env, { to: "ap@acmefreight.example", subject: "S", text: "T" })).toEqual({ ok: false, delivered: false, error: "E-mail sending isn't set up yet.", code: "email_unconfigured" });
      expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM email_outbox").first<{ n: number }>())!.n).toBe(0);
    }
  });
  it("refuses an empty recipient list", async () => {
    expect((await sendEmail(makeTestEnv(), { to: [" "], subject: "S", text: "T" })).ok).toBe(false);
  });
  it("parses sender forms", () => {
    expect(parseFrom("Probity <notifications@probity.larinova.com>")).toEqual({ name: "Probity", email: "notifications@probity.larinova.com" });
    expect(parseFrom("\"Probity Alerts\" <a@probity.larinova.com>")).toEqual({ name: "Probity Alerts", email: "a@probity.larinova.com" });
    expect(parseFrom("a@probity.larinova.com")).toBe("a@probity.larinova.com");
    expect(parseFrom("<a@probity.larinova.com>")).toBe("a@probity.larinova.com");
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
