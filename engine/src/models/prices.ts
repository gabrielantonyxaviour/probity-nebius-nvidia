import type { ModelId } from "@probity/shared";

/** USD per 1M tokens, from Nebius Token Factory's public model list. */
export const PRICES: Record<ModelId, { input: number; cached: number; output: number }> = {
  "nvidia/Nemotron-3-Ultra-550b-a55b": { input: 1.0, cached: 0.12, output: 3.0 },
  "nvidia/Nemotron-3.5-Super-VL": { input: 0.3, cached: 0.06, output: 0.9 },
  "nvidia/Nemotron-3_5-Lightning": { input: 0.06, cached: 0.03, output: 0.24 },
};

export interface Usage {
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
}

/** `promptTokens` includes the cached ones: the cached part is billed at the cached rate, the rest at the input rate. */
export function costUsd(model: ModelId, u: Usage): number {
  const p = PRICES[model];
  const cached = Math.min(u.cachedTokens, u.promptTokens);
  const fresh = u.promptTokens - cached;
  const usd = (fresh * p.input + cached * p.cached + u.completionTokens * p.output) / 1_000_000;
  return Math.round(usd * 1e8) / 1e8;
}
