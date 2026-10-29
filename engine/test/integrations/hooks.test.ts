import { afterEach, describe, expect, it, vi } from "vitest";
import { handleTrigger, verifyComposioSignature } from "../../src/integrations/hooks";
import { mightBeBankChange } from "../../src/integrations/classify";
import { parseTriggerData } from "../../src/integrations/messages";
import { hmacBase64, seal } from "../../src/integrations/util";
import { appFor, makeEnv, path, stubFetch } from "./harness";

afterEach(() => vi.unstubAllGlobals());

const gmailEvent = (over: Record<string, unknown> = {}) => ({
  type: "composio.trigger.message",
  metadata: { trigger_slug: "GMAIL_NEW_GMAIL_MESSAGE", connected_account_id: "ca_1", user_id: "org_acme" },
  data: { message_id: "m1", sender: "AR Team <ar@kettlepoint-billing.example>", subject: "Updated bank details effective 3 November", message_text: "Please update our bank account to routing 110000000. Letter attached.", attachment_list: [{ filename: "letter.pdf", mimeType: "application/pdf", attachmentId: "att1" }], message_timestamp: "2026-10-30T02:00:00Z", ...over },
});
function connected(env: ReturnType<typeof makeEnv>) {
  env.d1.exec("INSERT INTO connections (org_id, provider, status, account, connected_account_id, updated_at) VALUES ('org_acme','gmail','connected','ap@acme.test','ca_1','2026-10-30T00:00:00Z')");
}
const model = (answer: boolean) => (u: URL) => (u.pathname.endsWith("/chat/completions") ? { choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ vendor_bank_change: answer, reason: "test" }) } }], usage: { prompt_tokens: 400, completion_tokens: 12 } } : undefined);

describe("signature", () => {
  it("accepts Standard Webhooks signatures, rejects tampering and replays", async () => {
    const body = '{"a":1}';
    const sig = await hmacBase64(new TextEncoder().encode("whsec_test"), `msg_1.1000.${body}`);
    expect(await verifyComposioSignature("whsec_test", { id: "msg_1", timestamp: "1000", signature: `v1,${sig}` }, body, 1100)).toBe(true);
    expect(await verifyComposioSignature("whsec_test", { id: "msg_1", timestamp: "1000", signature: `v1,${sig}` }, '{"a":2}', 1100)).toBe(false);
    expect(await verifyComposioSignature("whsec_test", { id: "msg_1", timestamp: "1000", signature: `v1,${sig}` }, body, 9000)).toBe(false);
    expect(await verifyComposioSignature("whsec_test", { id: null, timestamp: "1000", signature: null }, body, 1100)).toBe(false);
  });
});

describe("classification gate", () => {
  it("only mail with banking words reaches the model", () => {
    expect(mightBeBankChange({ from: "a", subject: "Lunch on Friday?", text: "Are you free?", attachmentNames: [] })).toBe(false);
    expect(mightBeBankChange({ from: "a", subject: "Invoice 4471", text: "Attached. Please remit to our new account.", attachmentNames: [] })).toBe(true);
  });
  it("reads Gmail and Outlook trigger payloads", () => {
    const g = parseTriggerData("gmail", gmailEvent().data);
    expect(g).toMatchObject({ messageId: "m1", subject: "Updated bank details effective 3 November" });
    expect(g.attachments[0]).toMatchObject({ id: "att1", filename: "letter.pdf" });
    const o = parseTriggerData("outlook", { event_type: "created", id: "AAA", outlook_message: { id: "AAA", subject: "Remit-to change", from: { emailAddress: { name: "Pat", address: "pat@vendor.example" } }, body: { content: "new remit address" } } });
    expect(o).toMatchObject({ messageId: "AAA", from: '"Pat" <pat@vendor.example>', text: "new remit address" });
  });
});

describe("handleTrigger", () => {
  it("a vendor bank-change e-mail is fetched with its PDF and handed to intake once", async () => {
    const env = makeEnv({ seed: true });
    connected(env);
    const pdf = btoa("%PDF-1.4 ".padEnd(200, "x"));
    stubFetch([
      model(true),
      (u) => (path(u) === "/tools/execute/GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID" ? { successful: true, data: { messageText: "Full body text", payload: { headers: [{ name: "Reply-To", value: "other@elsewhere.example" }, { name: "Authentication-Results", value: "spf=pass dkim=pass" }] } } } : undefined),
      (u) => (path(u) === "/tools/execute/GMAIL_GET_ATTACHMENT" ? { successful: true, data: { file: { contentBytes: pdf } } } : undefined),
    ]);
    const intake = vi.fn(async () => ({ requestId: "BCR-X" }));
    expect(await handleTrigger(env as never, gmailEvent() as never, intake)).toBe("intake");
    const mail = (intake.mock.calls[0] as unknown as [unknown, any])[1];
    expect(mail).toMatchObject({ orgId: "org_acme", source: "gmail", messageId: "m1", replyTo: "other@elsewhere.example", text: "Full body text" });
    expect(mail.headers["Authentication-Results"]).toContain("spf=pass");
    expect(mail.attachments).toHaveLength(1);
    expect(new Uint8Array(mail.attachments[0].bytes).byteLength).toBeGreaterThan(100);
    // the same delivery again is a no-op
    expect(await handleTrigger(env as never, gmailEvent() as never, intake)).toBe("duplicate");
    expect(intake).toHaveBeenCalledTimes(1);
    const c = await env.d1.prepare("SELECT seen, matched, ignored FROM intake_counters WHERE org_id = 'org_acme'").first<Record<string, number>>();
    expect(c).toEqual({ seen: 1, matched: 1, ignored: 0 });
  });

  it("ordinary mail is ignored: counted, never stored, no model call without banking words", async () => {
    const env = makeEnv({ seed: true });
    connected(env);
    const log = stubFetch([]);
    const intake = vi.fn();
    expect(await handleTrigger(env as never, gmailEvent({ message_id: "m2", subject: "Team lunch", message_text: "Pizza at noon", attachment_list: [] }) as never, intake)).toBe("ignored");
    expect(log).toHaveLength(0);
    expect(intake).not.toHaveBeenCalled();
    const stored = await env.d1.prepare("SELECT message_id, outcome FROM inbound_messages").all<Record<string, string>>();
    expect(stored.results).toEqual([{ message_id: "gmail:m2", outcome: "ignored" }]);
  });

  it("banking words but the model says it is not a vendor request: ignored", async () => {
    const env = makeEnv({ seed: true });
    connected(env);
    stubFetch([model(false)]);
    const intake = vi.fn();
    expect(await handleTrigger(env as never, gmailEvent({ message_id: "m3", subject: "Your statement", message_text: "Your account balance is ready", attachment_list: [] }) as never, intake)).toBe("ignored");
    expect(intake).not.toHaveBeenCalled();
  });

  it("an event for an account we do not know, or from our own mailbox, does nothing", async () => {
    const env = makeEnv({ seed: true });
    connected(env);
    const intake = vi.fn();
    const ev = gmailEvent() as { metadata: Record<string, string> };
    expect(await handleTrigger(env as never, { ...ev, metadata: { ...ev.metadata, connected_account_id: "ca_other" } } as never, intake)).toBe("unknown");
    expect(await handleTrigger(env as never, gmailEvent({ message_id: "m4", sender: "ap@acme.test" }) as never, intake)).toBe("ignored");
    expect(intake).not.toHaveBeenCalled();
  });

  it("an intake failure is recorded as failed, not thrown", async () => {
    const env = makeEnv({ seed: true });
    connected(env);
    stubFetch([model(true), (u) => (path(u).startsWith("/tools/execute/") ? { successful: false, error: "nope", data: {} } : undefined)]);
    expect(await handleTrigger(env as never, gmailEvent({ message_id: "m5" }) as never, vi.fn(async () => { throw new Error("boom"); }))).toBe("failed");
  });
});

describe("POST /hooks/composio", () => {
  it("rejects unsigned calls and accepts a signed one", async () => {
    const env = makeEnv({ seed: true });
    connected(env);
    await env.d1.prepare("INSERT INTO settings (key, value) VALUES ('composio_webhook_secret', ?1)").bind(await seal("ck_test", "whsec_test")).run();
    const body = JSON.stringify({ type: "composio.connected_account.expired", metadata: { user_id: "org_acme", connected_account_id: "ca_1" } });
    const app = appFor("org_acme");
    expect((await app.request("/api/hooks/composio", { method: "POST", body }, env as never)).status).toBe(401);
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = await hmacBase64(new TextEncoder().encode("whsec_test"), `msg_9.${ts}.${body}`);
    const ok = await app.request("/api/hooks/composio", { method: "POST", body, headers: { "webhook-id": "msg_9", "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` } }, env as never);
    expect(ok.status).toBe(200);
    expect((await env.d1.prepare("SELECT status, detail FROM connections WHERE provider = 'gmail'").first<Record<string, string>>())).toMatchObject({ status: "error" });
  });
});
