// Manual live check of the three keyless registries (not part of `vitest run`): npx tsx test/evidence/live.smoke.ts "Booz Allen Hamilton Inc."
import { lookupEdgar, lookupGleif, lookupUsaspending } from "../../src/evidence";
import { makeEnv } from "./fake-env";

const env = makeEnv();
env.SEC_USER_AGENT = process.env.SEC_USER_AGENT ?? env.SEC_USER_AGENT;
for (const name of process.argv.slice(2)) {
  for (const [label, fn] of [["edgar", lookupEdgar], ["usaspending", lookupUsaspending], ["gleif", lookupGleif]] as const) {
    const t0 = Date.now();
    const r = await fn(env, { name });
    process.stdout.write(`\n## ${label} ${name} (${Date.now() - t0} ms, ${r.evidence.length} facts)\n${r.summary}\n`);
    for (const e of r.evidence) process.stdout.write(`  ${e.id} [${e.field}] ${e.label}: ${e.value}${e.cached ? " (cached)" : ""}\n`);
  }
}
