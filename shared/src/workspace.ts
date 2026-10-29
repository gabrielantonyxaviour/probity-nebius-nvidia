// Workspace contract: who is signed in, the company workspace, its connections, payment-run schedule and plan.
import { z } from "zod";

export const DEMO_ORG_ID = "org_demo";

export const Plan = z.enum(["free", "pro"]);
export type Plan = z.infer<typeof Plan>;

export const Me = z.object({
  user: z.object({ id: z.string(), email: z.string(), name: z.string().nullable() }).nullable(), // null = not signed in (demo)
  org: z.object({
    id: z.string(),
    name: z.string(),
    isDemo: z.boolean(), // the shared demo company everyone sees without signing in
    plan: Plan,
    role: z.enum(["owner", "admin", "member", "viewer"]), // viewer for the demo when not signed in
  }),
  orgs: z.array(z.object({ id: z.string(), name: z.string() })), // workspaces this user belongs to
});
export type Me = z.infer<typeof Me>;

export const Provider = z.enum(["gmail", "outlook", "xero", "slack"]);
export type Provider = z.infer<typeof Provider>;

export const Connection = z.object({
  provider: Provider,
  status: z.enum(["not_connected", "pending", "connected", "error"]),
  account: z.string().nullable(), // "ap@acme.com", "Demo Company (US)", "#ap-payments"
  connectedAt: z.string().nullable(),
  detail: z.string().nullable(), // last error or a short note: "Watching for new mail · last checked 2 min ago"
});
export type Connection = z.infer<typeof Connection>;

export const PaymentRun = z.object({
  weekday: z.number().int().min(0).max(6), // 0 = Sunday
  cutoff: z.string().regex(/^\d{2}:\d{2}$/), // local time, e.g. "14:00"
});
export const Schedule = z.object({
  timezone: z.string(), // IANA, e.g. "America/New_York"
  runs: z.array(PaymentRun).max(14),
  recheckMinutesBefore: z.number().int().min(15).max(24 * 60), // the final re-check starts this long before each cut-off
  notifyEmails: z.array(z.string().email()).max(10), // the pre-run summary goes here and to Slack
  nextRecheckAt: z.string().nullable(), // computed by the engine, ISO
});
export type Schedule = z.infer<typeof Schedule>;

export const Billing = z.object({
  plan: Plan,
  status: z.enum(["none", "active", "on_hold", "cancelled", "failed"]),
  renewsAt: z.string().nullable(),
  priceLabel: z.string(), // "$49 / month per company"
  limits: z.object({ checksPerMonth: z.number().int(), checksUsed: z.number().int() }),
});
export type Billing = z.infer<typeof Billing>;

// Routes (engine; proxied unchanged by the web Worker):
// GET  /api/me                                  -> Me                       (auth module)
// ALL  /api/auth/*                              -> Better Auth handler        (sign-in by e-mail code, organisations)
// POST /api/workspaces { name }                 -> Me                       (create a company workspace; caller becomes owner)
// POST /api/workspaces/switch { orgId }         -> Me
// GET  /api/connections                         -> Connection[]             (integrations module)
// POST /api/connections/:provider/start         -> { redirectUrl }          (Composio connect link, or Slack OAuth)
// POST /api/connections/:provider/disconnect    -> Connection[]
// GET  /api/connections/callback?...            -> 302 to /settings?connected=<provider>
// POST /api/hooks/composio                      -> 200                      (signed trigger webhook: new Gmail/Outlook mail)
// POST /api/hooks/slack/interact                -> 200                      (signed Slack button clicks)
// GET  /api/schedule  PUT /api/schedule Schedule -> Schedule                (integrations/schedule module)
// GET  /api/billing                             -> Billing                  (billing module)
// POST /api/billing/checkout                    -> { url }                  (Dodo hosted checkout)
// POST /api/billing/portal                      -> { url }
// POST /api/billing/webhook                     -> 200                      (signed Dodo webhook)
// POST /api/billing/redeem { code }             -> Billing                  (judge code fallback)
