// After a connection is made: who is it? (the mailbox address, the Xero organisation) and, for mail, start watching for new messages.
import { deleteTrigger, executeTool, upsertTrigger } from "./composio";
import type { IntEnv } from "./env";
import { asObject, deepFind } from "./util";
import type { Provider } from "@probity/shared";

export type Identity = { account: string; meta?: Record<string, string> };

export async function identify(env: IntEnv, provider: "gmail" | "outlook" | "xero", orgId: string, accountId: string): Promise<Identity | null> {
  if (provider === "gmail") {
    const r = await executeTool(env, "GMAIL_GET_PROFILE", orgId, accountId, { user_id: "me" });
    const email = deepFind(asObject(r.data), ["emailAddress", "email"]);
    return email ? { account: email } : null;
  }
  if (provider === "outlook") {
    const r = await executeTool(env, "OUTLOOK_GET_PROFILE", orgId, accountId, {});
    const mail = deepFind(asObject(r.data), ["mail", "userPrincipalName", "email"]);
    return mail ? { account: mail } : null;
  }
  const r = await executeTool(env, "XERO_GET_CONNECTIONS", orgId, accountId, {});
  const data = asObject(r.data);
  const tenantId = deepFind(data, ["tenantId", "tenant_id"]);
  const name = deepFind(data, ["tenantName", "organisationName", "name"]);
  return tenantId ? { account: name ?? "Xero organisation", meta: { tenantId } } : null;
}

const TRIGGERS: Partial<Record<Provider, { slug: string; config: Record<string, unknown> }>> = {
  gmail: { slug: "GMAIL_NEW_GMAIL_MESSAGE", config: { interval: 2, labelIds: "INBOX", userId: "me" } },
  outlook: { slug: "OUTLOOK_MESSAGE_TRIGGER", config: {} },
};

/** Subscribes the new-message trigger for a mailbox; returns the trigger instance id (null for providers with no trigger). */
export async function watchMailbox(env: IntEnv, provider: Provider, orgId: string, accountId: string): Promise<string | null> {
  const t = TRIGGERS[provider];
  return t ? upsertTrigger(env, t.slug, orgId, accountId, t.config) : null;
}
export const unwatchMailbox = async (env: IntEnv, triggerId: string): Promise<void> => deleteTrigger(env, triggerId);
