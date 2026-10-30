import type { Money, Source, Verdict } from "@probity/shared";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usdShort = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });

export const money = (m: Money) => usd.format(m.cents / 100);
export const moneyShort = (cents: number) => usdShort.format(cents / 100);
export const dollars = (n: number) => (n < 0.01 ? "<$0.01" : `$${n.toFixed(n < 1 ? 3 : 2)}`);

export function dateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", month: "short", day: "numeric" });
}
export function time(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** "2 h 14 min" until an ISO time; "passed" when it's gone. */
export function until(iso: string, now = Date.now()) {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "passed";
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ${min % 60} min`;
  return `${Math.round(h / 24)} days`;
}

export function seconds(ms: number) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
}

export const VERDICT: Record<Verdict, { word: string; chip: "approve" | "callback" | "hold"; line: string }> = {
  APPROVE: { word: "Approve", chip: "approve", line: "The change can go into the payment run." },
  CALLBACK_VERIFY: { word: "Call back", chip: "callback", line: "Call the vendor on the number below before this change is used." },
  HOLD: { word: "Hold", chip: "hold", line: "Don't use these details. Keep paying the account on file." },
};

export const SOURCE_LABEL: Record<Source, string> = {
  sec_edgar: "SEC EDGAR",
  usaspending: "USAspending",
  gleif: "GLEIF",
  vendor_master: "Vendor master",
  tavily: "Web · Tavily",
  request: "The request",
};

export const MODEL_SHORT: Record<string, { name: string; role: string }> = {
  "nvidia/Nemotron-3-Ultra-550b-a55b": { name: "Nemotron 3 Ultra", role: "reasons" },
  "nvidia/Nemotron-3.5-Super-VL": { name: "Nemotron 3.5 Super VL", role: "sees and plans" },
  "nvidia/Nemotron-3_5-Lightning": { name: "Nemotron 3.5 Lightning", role: "screens, looks up, writes" },
};
