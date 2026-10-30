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
  hasSubscription: z.boolean().default(false), // true once Dodo has created a subscription for this company (paid or the $0 judges' one)
  priceLabel: z.string(), // "$49 / month per company"
  limits: z.object({ checksPerMonth: z.number().int(), checksUsed: z.number().int() }),
});
export type Billing = z.infer<typeof Billing>;

// Vendors: the company's vendor list (the vendors of record every check is made against).
export const VendorSource = z.enum(["xero", "manual", "sample"]);
export type VendorSource = z.infer<typeof VendorSource>;

const Hostname = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/, "Use a plain domain such as acme.com.");

export const VendorInput = z.object({
  legalName: z.string().trim().min(2, "The legal name needs at least 2 characters.").max(120, "The legal name can be at most 120 characters."),
  domains: z.array(Hostname).max(5, "At most 5 e-mail domains.").default([]), // lowercased; the sender domains this vendor writes from
  phone: z.string().trim().max(32).regex(/^\+?[\d\s().-]{7,32}$/, "Enter the phone number as digits, for example (757) 555-0190.").optional(), // the number on file used for call-backs
  bank: z
    .object({
      bankName: z.string().trim().min(2).max(80),
      routing: z.string().trim().regex(/^\d{9}$/, "The routing number is 9 digits."),
      accountLast4: z.string().trim().regex(/^\d{4}$/, "Give the last 4 digits of the account.").optional(),
      account: z.string().trim().regex(/^\d{4,17}$/, "The account number is 4 to 17 digits.").optional(), // never returned; only a hash and the last 4 are kept
    })
    .refine((b) => b.account !== undefined || b.accountLast4 !== undefined, { message: "Give the account number or its last 4 digits.", path: ["account"] })
    .optional(),
});
export type VendorInput = z.input<typeof VendorInput>;

export const Vendor = z.object({
  id: z.string(),
  legalName: z.string(),
  source: VendorSource, // sample = copied from the demo company; xero = managed by the Xero sync
  status: z.enum(["active", "inactive"]),
  domains: z.array(z.string()),
  phone: z.string().nullable(), // the call-back number on file
  bank: z.object({ bankName: z.string(), last4: z.string() }).nullable(), // never the full account number
  createdAt: z.string(),
});
export type Vendor = z.infer<typeof Vendor>;

export const ImportResult = z.object({
  added: z.number().int(),
  skipped: z.array(z.object({ row: z.number().int(), reason: z.string() })), // row 1 is the header, so the first vendor is row 2
});
export type ImportResult = z.infer<typeof ImportResult>;

export const SamplesResult = z.object({ added: z.number().int(), skipped: z.number().int() }); // skipped = already in the list
export type SamplesResult = z.infer<typeof SamplesResult>;

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
// POST /api/billing/redeem { code }             -> { url }                  (judge code: the $0 Dodo checkout, never a local grant)
// GET    /api/vendors                           -> Vendor[]                 (up to 500, A-Z; anyone, scoped to the active company)
// POST   /api/vendors VendorInput               -> Vendor                   (201; admin; 409 duplicate)
// POST   /api/vendors/import  text/csv | { csv } -> ImportResult             (admin; columns name,domain,phone,bank_name,routing,account)
// POST   /api/vendors/samples                   -> SamplesResult            (admin; copies the demo company's sample vendors; idempotent)
// DELETE /api/vendors/:id                       -> { ok: true }             (admin; manual and sample vendors only; 409 xero_managed | in_use)
