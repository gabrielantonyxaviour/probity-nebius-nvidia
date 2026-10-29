// A fake Worker environment with the engine's own migrations (0010-0019) applied on top of B's schema.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeEnv, type FakeEnv } from "./evidence/fake-env";

const dir = join(import.meta.dirname, "../migrations");

export function makeTenantEnv(opts: { seed?: boolean } = {}): FakeEnv {
  const env = makeEnv(opts);
  for (const f of readdirSync(dir).sort()) if (/^001\d_/.test(f)) env.d1.exec(readFileSync(join(dir, f), "utf8"));
  return env;
}
