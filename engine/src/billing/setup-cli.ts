// One-off Dodo setup for a mode: creates the Probity Pro product, the judges' discount code and the webhook endpoint (idempotent).
// Usage (from engine/), test mode:
//   DODO_PAYMENTS_API_KEY=... DODO_BRAND_ID=brnd_... APP_URL=https://probity.pages.dev npx tsx src/billing/setup-cli.ts [--write-secret FILE]
// Live mode: DODO_MODE=live DODO_PAYMENTS_LIVE_API_KEY=... (same other variables). Re-running is safe: it finds what exists.
// Prints the mode and ids only. The webhook signing secret is written to the named file (DODO_WEBHOOK_SECRET=...), never printed.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { CEnv } from "../auth/types";
import { dodo, dodoBase, dodoMode, ensureJudgeDiscount, ensureProProduct } from "./dodo";

const store = new Map<string, string>();
const db = {
  prepare: (sql: string) => ({
    bind: (...a: unknown[]) => ({
      first: async () => (sql.startsWith("SELECT") ? { value: store.get(String(a[0])) ?? null } : null),
      run: async () => { if (sql.startsWith("INSERT")) store.set(String(a[0]), String(a[1])); return {}; },
    }),
  }),
};
const env = { ...process.env, DB: db } as unknown as CEnv;
const appUrl = process.env.APP_URL ?? "https://probity.pages.dev";
const hookUrl = `${appUrl}/api/billing/webhook`;

async function main() {
  const productId = await ensureProProduct(env);
  const discountId = await ensureJudgeDiscount(env);

  const hooks = await dodo<{ data?: { id: string; url: string }[] }>(env, "GET", "/webhooks");
  let hook = hooks.data?.find((h) => h.url === hookUrl);
  if (!hook) {
    hook = await dodo<{ id: string; url: string }>(env, "POST", "/webhooks", {
      url: hookUrl,
      description: "Probity billing",
      filter_types: ["subscription.active", "subscription.renewed", "subscription.on_hold", "subscription.cancelled", "subscription.failed", "subscription.expired", "payment.succeeded", "payment.failed"],
    });
  }
  const secret = (await dodo<{ secret: string }>(env, "GET", `/webhooks/${hook.id}/secret`)).secret;
  const out = process.argv.indexOf("--write-secret");
  if (out > -1 && process.argv[out + 1]) {
    const file = process.argv[out + 1]!;
    const kept = (existsSync(file) ? readFileSync(file, "utf8") : "").split("\n").filter((l) => l && !l.startsWith("DODO_WEBHOOK_SECRET="));
    writeFileSync(file, [...kept, `DODO_WEBHOOK_SECRET=${secret}`].join("\n") + "\n", { mode: 0o600 });
  }
  process.stdout.write(`mode ${dodoMode(env)} (${dodoBase(env)})\nbrand ${env.DODO_BRAND_ID ?? "(account default)"}\nproduct ${productId}\ndiscount ${discountId}\nwebhook ${hook.id} ${hook.url}\n`);
}

main().catch((e: unknown) => {
  process.stderr.write(`Setup failed: ${e instanceof Error ? e.message : "unknown error"}\n`);
  process.exit(1);
});
