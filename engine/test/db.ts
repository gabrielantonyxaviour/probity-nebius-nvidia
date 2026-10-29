// A fake Worker environment with every migration applied (the shared fake env now loads engine/migrations in order).
import { makeEnv, type FakeEnv } from "./evidence/fake-env";

export const makeTenantEnv = (opts: { seed?: boolean } = {}): FakeEnv => makeEnv(opts);
