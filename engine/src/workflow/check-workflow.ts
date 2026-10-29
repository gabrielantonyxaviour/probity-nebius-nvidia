// The Cloudflare Workflow that runs one check. Each stage is a durable step; D1 holds the Run the UI polls.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { z } from "zod";
import { runCheck, type Steps } from "../check/pipeline";
import type { Ctx } from "../check/types";
import type { Env } from "../env";
import pdfiumWasm from "@hyzyla/pdfium/pdfium.wasm";
import { D1RunStore, setRequestState } from "./d1store";
import { r2Files } from "./files";

export const CheckParams = z.object({ runId: z.string().min(1).max(64), sessionId: z.string().min(1).max(64) });
export type CheckParams = z.infer<typeof CheckParams>;

export class CheckWorkflow extends WorkflowEntrypoint<Env, CheckParams> {
  async run(event: WorkflowEvent<CheckParams>, step: WorkflowStep): Promise<void> {
    const { runId, sessionId } = CheckParams.parse(event.payload);
    const ctx: Ctx = { env: this.env, runId, sessionId, store: new D1RunStore(this.env.DB), files: r2Files(this.env.FILES), wasm: pdfiumWasm };
    const steps: Steps = {
      do: <T>(name: string, fn: () => Promise<T>) =>
        step.do(name, { retries: { limit: 1, delay: "3 seconds", backoff: "constant" }, timeout: "5 minutes" }, fn as never) as Promise<T>,
    };
    const run = await ctx.store.get(runId);
    try {
      await runCheck(ctx, steps);
      await setRequestState(this.env.DB, run.requestId, { status: "checked" });
    } catch {
      await setRequestState(this.env.DB, run.requestId, { status: "unchecked" });
    }
  }
}
