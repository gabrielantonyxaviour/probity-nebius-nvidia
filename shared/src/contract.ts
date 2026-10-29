// The API contract between the engine Worker and the web UI. Both sides import from here.
// Changing a shape here is a coordinated change: engine, web and fixtures move together.
import { z } from "zod";

export * from "./workspace";

export const POLICY_VERSION = "pp-2026-10-30.1";

export const Verdict = z.enum(["APPROVE", "CALLBACK_VERIFY", "HOLD"]);
export type Verdict = z.infer<typeof Verdict>;

export const Money = z.object({ cents: z.number().int(), currency: z.literal("USD") });
export type Money = z.infer<typeof Money>;

/** Where a fact came from. `request` = the letter or e-mail itself (never trusted). */
export const Source = z.enum(["sec_edgar", "usaspending", "gleif", "vendor_master", "tavily", "request"]);
export type Source = z.infer<typeof Source>;

export const ModelId = z.enum([
  "nvidia/Nemotron-3-Ultra-550b-a55b",
  "nvidia/Nemotron-3.5-Super-VL",
  "nvidia/Nemotron-3_5-Lightning",
]);
export type ModelId = z.infer<typeof ModelId>;

export const AgentKey = z.enum(["letter_reader", "registry_scout", "identity_examiner", "gate_officer", "screen"]);
export type AgentKey = z.infer<typeof AgentKey>;

// ---------- Inbox ----------

export const RequestStatus = z.enum(["unchecked", "checking", "checked", "closed"]);

export const InboxItem = z.object({
  requestId: z.string(), // e.g. BCR-2026-0441
  vendorId: z.string(),
  vendorName: z.string(),
  kind: z.enum(["bank_change", "remit_change"]),
  receivedAt: z.string(), // ISO
  senderEmail: z.string(),
  amountAtRisk: Money, // the next payment-run amount that would go to the new details
  nextRunAt: z.string().nullable(), // ISO, the payment run's cut-off
  status: RequestStatus,
  verdict: Verdict.nullable(), // latest decision, null until checked
  outcome: z.enum(["confirmed", "denied", "no_answer"]).nullable(),
  runId: z.string().nullable(), // latest run
  sweptAt: z.string().nullable(), // when the Nebius sweep last looked at it
  synthetic: z.boolean(), // true for every example request
  source: z.enum(["seed", "upload", "gmail", "outlook"]).default("seed"), // how the request reached Probity
});
export type InboxItem = z.infer<typeof InboxItem>;

// ---------- One check (a run) ----------

export const StepStatus = z.enum(["pending", "running", "done", "failed", "skipped"]);
export const Step = z.object({
  key: z.string(), // stable, e.g. "pdf", "read_text", "read_image", "screen", "scout", "examine", "gate", "rationale"
  agent: AgentKey.nullable(), // null for code-only steps
  label: z.string(), // plain words for the clerk: "Reading the page image"
  status: StepStatus,
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  summary: z.string().nullable(), // one line when done: "3 claims read; 1 line a person cannot see"
});
export type Step = z.infer<typeof Step>;

export const ModelCall = z.object({
  id: z.string(),
  stepKey: z.string(),
  agent: AgentKey,
  model: ModelId,
  thinking: z.boolean(),
  startedAt: z.string(),
  ms: z.number(),
  promptTokens: z.number().int(),
  cachedTokens: z.number().int(),
  completionTokens: z.number().int(),
  costUsd: z.number(),
  requestId: z.string().nullable(), // Token Factory's response id, for the feedback field
  toolCalls: z.array(z.string()), // tool names the model chose, in order
});
export type ModelCall = z.infer<typeof ModelCall>;

/** One fact with its provenance. Every reason and every call-card number points at these ids. */
export const Evidence = z.object({
  id: z.string(), // ev-<source>-<n>
  source: Source,
  field: z.enum(["legal_name", "address", "phone", "domain", "bank_account", "parent", "identifier", "news", "other"]),
  label: z.string(), // "Registered business phone"
  value: z.string(),
  url: z.string().nullable(), // public source URL where one exists
  retrievedAt: z.string(),
  cached: z.boolean(), // served from cache rather than fetched for this run
});
export type Evidence = z.infer<typeof Evidence>;

export const HiddenText = z.object({
  page: z.number().int(), // 0-based
  text: z.string(),
  why: z.enum(["white_on_white", "tiny_glyphs", "off_page", "under_image", "not_in_page_image"]),
  detail: z.string(), // "fill #ffffff on #ffffff, 6 pt"
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(), // x0,y0,x1,y1 in PDF points, origin top-left
});
export type HiddenText = z.infer<typeof HiddenText>;

export const Claim = z.object({
  field: z.enum(["legal_name", "remit_address", "bank_name", "routing_number", "account_number", "phone", "email", "effective_date", "signatory", "other"]),
  value: z.string(), // account numbers arrive masked: ••••6789
  quote: z.string(), // the exact words in the letter
  inImage: z.boolean(), // the second reading (page image) saw it too
});
export type Claim = z.infer<typeof Claim>;

export const LetterReading = z.object({
  pageCount: z.number().int(),
  pageImages: z.array(z.string()), // file keys, served at /api/files/:key
  pageSize: z.tuple([z.number(), z.number()]), // width, height in PDF points
  claims: z.array(Claim),
  hidden: z.array(HiddenText),
  scanned: z.boolean(), // no text layer: Super VL's reading is the only one
});
export type LetterReading = z.infer<typeof LetterReading>;

export const ScreenFlag = z.object({
  source: z.enum(["letter", "email", "web"]),
  text: z.string(),
  why: z.string(), // "Addresses an AI reviewer and asks it to approve"
  by: z.enum(["lightning", "nemo_input_rail", "content_safety"]),
});
export const Screen = z.object({ spansScreened: z.number().int(), flags: z.array(ScreenFlag) });
export type Screen = z.infer<typeof Screen>;

export const Reason = z.object({
  code: z.string(), // policy code, e.g. "R3"
  severity: z.enum(["hold", "callback", "info"]),
  text: z.string(), // plain sentence for the clerk, no codes
  evidenceIds: z.array(z.string()),
});
export type Reason = z.infer<typeof Reason>;

export const CallCard = z.object({
  phone: z.string().nullable(), // E.164-ish display, e.g. "(703) 902-5000"; null when no independent number exists
  sources: z.array(z.object({ evidenceId: z.string(), source: Source, label: z.string() })), // never "request"
  letterPhones: z.array(z.string()), // numbers the letter offered: shown crossed out
  ask: z.array(z.string()), // what to confirm on the call, in plain words
});
export type CallCard = z.infer<typeof CallCard>;

export const Outcome = z.object({
  result: z.enum(["confirmed", "denied", "no_answer"]),
  by: z.string(), // "AP clerk" in the demo
  at: z.string(),
  note: z.string().nullable(),
});
export type Outcome = z.infer<typeof Outcome>;

export const Decision = z.object({
  verdict: Verdict, // the gate's verdict before any call
  finalVerdict: Verdict, // after the outcome: confirmed+CALLBACK_VERIFY -> APPROVE, denied -> HOLD
  reasons: z.array(Reason), // ordered: holds first; the UI shows the first three
  rationale: z.string(), // written by Lightning; numbers checked by code
  rationaleChecked: z.boolean(),
  callCard: CallCard,
  policyVersion: z.string(),
  outcome: Outcome.nullable(),
});
export type Decision = z.infer<typeof Decision>;

export const RunStatus = z.enum(["queued", "running", "done", "failed"]);
export const Run = z.object({
  id: z.string(),
  requestId: z.string(),
  vendorName: z.string(),
  status: RunStatus,
  live: z.boolean(), // false = a recorded run replayed for free
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  steps: z.array(Step),
  calls: z.array(ModelCall),
  evidence: z.array(Evidence),
  letter: LetterReading.nullable(),
  screen: Screen.nullable(),
  decision: Decision.nullable(),
  totals: z.object({ costUsd: z.number(), promptTokens: z.number(), cachedTokens: z.number(), completionTokens: z.number(), tavilyCredits: z.number() }),
  error: z.string().nullable(),
});
export type Run = z.infer<typeof Run>;

// ---------- Requests, limits, sweep ----------

export const RequestDetail = InboxItem.extend({
  letterKey: z.string(), // file key of the PDF
  email: z.object({ from: z.string(), replyTo: z.string().nullable(), subject: z.string(), received: z.string(), spf: z.string().nullable(), dkim: z.string().nullable() }),
  vendorOnFile: z.object({ legalName: z.string(), remitAddress: z.string(), phone: z.string().nullable(), domain: z.string().nullable(), accountMasked: z.string() }),
});
export type RequestDetail = z.infer<typeof RequestDetail>;

export const StartCheck = z.object({ requestId: z.string() });
export const LogOutcome = z.object({ result: Outcome.shape.result, note: z.string().max(500).nullable() });

export const Limits = z.object({
  liveChecksLeftToday: z.number().int(),
  liveChecksPerDay: z.number().int(),
  sessionChecksLeft: z.number().int(),
  tavilyCreditsUsed: z.number().int(),
  tavilyBudget: z.number().int(),
  stopped: z.boolean(), // kill switch: recorded runs only
});
export type Limits = z.infer<typeof Limits>;

export const SweepReport = z.object({
  jobId: z.string(), // Nebius job id, aijob-...
  state: z.enum(["starting", "running", "completed", "failed"]),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  requestsSwept: z.number().int(),
  recheckedRequestIds: z.array(z.string()), // full checks started because registry facts changed
  nemo: z.object({ spansChecked: z.number().int(), flagged: z.number().int(), outputChecks: z.number().int(), outputBlocked: z.number().int() }),
  /** Present after an `eval` run over the labelled test letters: measured, never estimated. */
  eval: z.object({ cases: z.number().int(), injected: z.number().int(), caught: z.number().int(), clean: z.number().int(), falseAlarms: z.number().int() }).nullable().default(null),
  costUsd: z.number(),
});
export type SweepReport = z.infer<typeof SweepReport>;

/** Every API error body. */
export const ApiError = z.object({ error: z.string(), code: z.string().optional() });
export type ApiError = z.infer<typeof ApiError>;

// Routes (engine; the web Worker proxies /api/* to it unchanged):
// GET  /api/inbox                      -> InboxItem[]
// GET  /api/requests/:id               -> RequestDetail
// POST /api/checks        StartCheck   -> { runId }            429 { code: "cap_reached" | "session_cap" | "stopped" }
// POST /api/checks/upload multipart pdf, eml?, vendorName -> { runId, requestId }
// GET  /api/runs/:id                   -> Run                  (poll every 1.5 s while running)
// POST /api/runs/:id/outcome LogOutcome -> Run
// GET  /api/limits                     -> Limits
// GET  /api/sweep/latest               -> SweepReport | null
// GET  /api/files/:key                 -> bytes (letter PDFs, page PNGs)
