import { z } from "zod";
import {
  ApiError, Billing, Connection, InboxItem, Limits, Me, RequestDetail, Run, Schedule, SweepReport,
  type Billing as BillingT, type Connection as ConnectionT, type Me as MeT, type Provider as ProviderT, type Schedule as ScheduleT,
  type InboxItem as InboxItemT, type Limits as LimitsT, type RequestDetail as RequestDetailT,
  type Run as RunT, type SweepReport as SweepReportT,
} from "@probity/shared";

export class ApiFailure extends Error {
  constructor(message: string, readonly code: string | undefined, readonly status: number) {
    super(message);
  }
}

async function call<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new ApiFailure("Can't reach Probity. Check your connection and try again.", "network", 0);
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = ApiError.safeParse(body);
    throw new ApiFailure(err.success ? err.data.error : `Request failed (${res.status})`, err.success ? err.data.code : undefined, res.status);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiFailure("Probity sent a response this page doesn't understand.", "bad_shape", res.status);
  return parsed.data;
}

const json = (body: unknown): RequestInit => ({
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

export const api = {
  inbox: (): Promise<InboxItemT[]> => call("/api/inbox", z.array(InboxItem)),
  request: (id: string): Promise<RequestDetailT> => call(`/api/requests/${id}`, RequestDetail),
  run: (id: string): Promise<RunT> => call(`/api/runs/${id}`, Run),
  limits: (): Promise<LimitsT> => call("/api/limits", Limits),
  sweep: (): Promise<SweepReportT | null> => call("/api/sweep/latest", SweepReport.nullable()),
  startCheck: (requestId: string) => call("/api/checks", z.object({ runId: z.string() }), json({ requestId })),
  logOutcome: (runId: string, result: "confirmed" | "denied" | "no_answer", note: string | null) =>
    call(`/api/runs/${runId}/outcome`, Run, json({ result, note })),
  upload: (form: FormData) =>
    call("/api/checks/upload", z.object({ runId: z.string(), requestId: z.string() }), { method: "POST", body: form }),
};

const put = (body: unknown): RequestInit => ({
  method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
const Url = z.object({ url: z.string() });

/** Account, workspace, connections, schedule and billing. Sign-in goes through Better Auth's e-mail code endpoints. */
export const account = {
  me: (): Promise<MeT> => call("/api/me", Me),
  sendCode: (email: string) => call("/api/auth/email-otp/send-verification-otp", z.unknown(), json({ email, type: "sign-in" })),
  signIn: (email: string, otp: string) => call("/api/auth/sign-in/email-otp", z.unknown(), json({ email, otp })),
  signOut: () => call("/api/auth/sign-out", z.unknown(), json({})),
  createWorkspace: (name: string): Promise<MeT> => call("/api/workspaces", Me, json({ name })),
  switchWorkspace: (orgId: string): Promise<MeT> => call("/api/workspaces/switch", Me, json({ orgId })),
  connections: (): Promise<ConnectionT[]> => call("/api/connections", z.array(Connection)),
  connect: (provider: ProviderT) => call(`/api/connections/${provider}/start`, z.object({ redirectUrl: z.string() }), json({})),
  disconnect: (provider: ProviderT): Promise<ConnectionT[]> => call(`/api/connections/${provider}/disconnect`, z.array(Connection), json({})),
  schedule: (): Promise<ScheduleT> => call("/api/schedule", Schedule),
  saveSchedule: (s: Omit<ScheduleT, "nextRecheckAt">): Promise<ScheduleT> => call("/api/schedule", Schedule, put(s)),
  billing: (): Promise<BillingT> => call("/api/billing", Billing),
  checkout: () => call("/api/billing/checkout", Url, json({})),
  portal: () => call("/api/billing/portal", Url, json({})),
  redeem: (code: string): Promise<BillingT> => call("/api/billing/redeem", Billing, json({ code })),
};

export const fileUrl = (key: string) => `/api/files/${key.split("/").map(encodeURIComponent).join("/")}`;
