// Development-only fixtures shaped by the shared contract, used when PROBITY_MOCK=1 so the UI can be built
// before the engine runs. Registry values are the companies' public SEC EDGAR records; the buying company,
// its ledger and every letter are synthetic.
import type { Evidence, InboxItem, ModelCall, Run, Step } from "@probity/shared";

const RUN_CUTOFF = "2026-10-30T06:00:00Z"; // Fri 14:00 MYT
const now = "2026-10-30T01:10:00Z";

export const inbox: InboxItem[] = [
  { requestId: "BCR-2026-0407", vendorId: "V-10091", vendorName: "Sable Harbor Marine Logistics LLC", kind: "bank_change", receivedAt: "2026-10-22T09:41:00Z", senderEmail: "finance@sableharbor.example", amountAtRisk: { cents: 10913161, currency: "USD" }, nextRunAt: RUN_CUTOFF, status: "checked", verdict: "HOLD", outcome: null, runId: "run-sable", sweptAt: "2026-10-29T18:04:00Z", synthetic: true },
  { requestId: "BCR-2026-0412", vendorId: "V-10027", vendorName: "Booz Allen Hamilton Inc.", kind: "remit_change", receivedAt: "2026-10-22T15:12:00Z", senderEmail: "ap-remit@boozallen-payments.example", amountAtRisk: { cents: 128455000, currency: "USD" }, nextRunAt: RUN_CUTOFF, status: "checked", verdict: "HOLD", outcome: null, runId: "run-booz", sweptAt: "2026-10-29T18:04:00Z", synthetic: true },
  { requestId: "BCR-2026-0398", vendorId: "V-10044", vendorName: "L3Harris Technologies, Inc.", kind: "bank_change", receivedAt: "2026-10-20T14:05:00Z", senderEmail: "treasury.ops@l3harris.example", amountAtRisk: { cents: 27491525, currency: "USD" }, nextRunAt: RUN_CUTOFF, status: "checked", verdict: "CALLBACK_VERIFY", outcome: null, runId: "run-l3", sweptAt: "2026-10-29T18:04:00Z", synthetic: true },
  { requestId: "BCR-2026-0419", vendorId: "V-10052", vendorName: "Vectrus Systems Corporation", kind: "remit_change", receivedAt: "2026-10-27T11:20:00Z", senderEmail: "ar@vectrus.example", amountAtRisk: { cents: 4318870, currency: "USD" }, nextRunAt: RUN_CUTOFF, status: "unchecked", verdict: null, outcome: null, runId: null, sweptAt: null, synthetic: true },
  { requestId: "BCR-2026-0423", vendorId: "V-10063", vendorName: "CACI International Inc", kind: "bank_change", receivedAt: "2026-10-28T08:02:00Z", senderEmail: "billing@caci-intl.example", amountAtRisk: { cents: 16204400, currency: "USD" }, nextRunAt: RUN_CUTOFF, status: "unchecked", verdict: null, outcome: null, runId: null, sweptAt: null, synthetic: true },
];

const steps = (done: boolean): Step[] => [
  ["pdf", null, "Opening the letter"],
  ["read_text", "letter_reader", "Reading the letter's text"],
  ["read_image", "letter_reader", "Reading the page as a person sees it"],
  ["screen", "screen", "Screening every line for instructions aimed at an AI"],
  ["scout", "registry_scout", "Looking the vendor up in public registries and on the web"],
  ["examine", "identity_examiner", "Comparing the letter with the evidence"],
  ["gate", null, "Applying the payment policy"],
  ["rationale", "gate_officer", "Writing the decision up"],
].map(([key, agent, label]) => ({
  key: key as string, agent: agent as Step["agent"], label: label as string, status: done ? "done" : "pending",
  startedAt: done ? now : null, finishedAt: done ? now : null, summary: null,
}));

let callN = 0;
const call = (stepKey: string, agent: ModelCall["agent"], model: ModelCall["model"], ms: number, p: number, c: number, o: number, tools: string[] = []): ModelCall => {
  const price = { "nvidia/Nemotron-3-Ultra-550b-a55b": [1, 0.12, 3], "nvidia/Nemotron-3.5-Super-VL": [0.3, 0.06, 0.9], "nvidia/Nemotron-3_5-Lightning": [0.06, 0.03, 0.24] }[model];
  const costUsd = ((p - c) * price[0] + c * price[1] + o * price[2]) / 1e6;
  return { id: `call-${++callN}`, stepKey, agent, model, thinking: model.includes("Ultra"), startedAt: now, ms, promptTokens: p, cachedTokens: c, completionTokens: o, costUsd, requestId: `chatcmpl-${callN}`, toolCalls: tools };
};
export const sampleCalls = (): ModelCall[] => [
  call("read_text", "letter_reader", "nvidia/Nemotron-3-Ultra-550b-a55b", 9400, 6120, 2048, 1210),
  call("read_image", "letter_reader", "nvidia/Nemotron-3.5-Super-VL", 6100, 3890, 1024, 640),
  call("screen", "screen", "nvidia/Nemotron-3_5-Lightning", 1300, 2410, 1536, 210),
  call("scout", "registry_scout", "nvidia/Nemotron-3.5-Super-VL", 2200, 3100, 2048, 180, ["edgar_lookup", "usaspending_lookup"]),
  call("scout", "registry_scout", "nvidia/Nemotron-3.5-Super-VL", 1900, 4800, 3072, 160, ["vendor_master", "web_contact_lookup"]),
  call("examine", "identity_examiner", "nvidia/Nemotron-3-Ultra-550b-a55b", 14200, 9800, 4096, 2300),
  call("rationale", "gate_officer", "nvidia/Nemotron-3_5-Lightning", 900, 1800, 1024, 120),
];

const ev = (id: string, source: Evidence["source"], field: Evidence["field"], label: string, value: string, url: string | null): Evidence =>
  ({ id, source, field, label, value, url, retrievedAt: now, cached: false });

export const boozEvidence: Evidence[] = [
  ev("ev-sec_edgar-1", "sec_edgar", "legal_name", "Registered name", "Booz Allen Hamilton Holding Corp", "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001443646"),
  ev("ev-sec_edgar-2", "sec_edgar", "phone", "Registered business phone", "(703) 902-5000", "https://data.sec.gov/submissions/CIK0001443646.json"),
  ev("ev-sec_edgar-3", "sec_edgar", "address", "Registered business address", "8283 Greensboro Drive, McLean, VA 22102", "https://data.sec.gov/submissions/CIK0001443646.json"),
  ev("ev-tavily-1", "tavily", "phone", "Phone on the vendor's own contact page", "(703) 902-5000", "https://www.boozallen.com/contact.html"),
  ev("ev-tavily-2", "tavily", "domain", "Vendor's official domain", "boozallen.com", "https://www.boozallen.com/"),
  ev("ev-vendor_master-1", "vendor_master", "domain", "Sender domains on file", "boozallen.example", null),
  ev("ev-vendor_master-2", "vendor_master", "bank_account", "Account the requested one is already on", "Quillan Ridge Fleet Services · ••••4471", null),
  ev("ev-usaspending-1", "usaspending", "address", "Address on federal awards", "8283 Greensboro Dr, McLean, VA 22102-3830", "https://www.usaspending.gov/recipient/"),
  ev("ev-request-1", "request", "address", "New remit address in the letter", "1 Commvault Way, Suite 205, Tinton Falls, NJ 07724", null),
];

export function baseRun(id: string, requestId: string, vendorName: string, evidence: Evidence[]): Run {
  const calls = sampleCalls();
  const sum = (k: "costUsd" | "promptTokens" | "cachedTokens" | "completionTokens") => calls.reduce((a, c) => a + c[k], 0);
  return {
    id, requestId, vendorName, status: "done", live: false, startedAt: "2026-10-30T01:02:10Z", finishedAt: "2026-10-30T01:03:24Z",
    steps: steps(true), calls, evidence, letter: null, screen: { spansScreened: 41, flags: [] }, decision: null,
    totals: { costUsd: sum("costUsd"), promptTokens: sum("promptTokens"), cachedTokens: sum("cachedTokens"), completionTokens: sum("completionTokens"), tavilyCredits: 2 },
    error: null,
  };
}
export { steps as fixtureSteps };
