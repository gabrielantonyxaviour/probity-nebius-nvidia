// The whole check, in order. The Workflow and the local smoke test both call this; only the step runner differs.
import { failRun, finishRun, runStep } from "./run";
import { examineStage } from "./examinestage";
import { gateStage, rationaleStage } from "./decidestage";
import { pdfStage } from "./pdfstage";
import { readImageStage, readTextStage } from "./readstage";
import { scoutStage } from "./scoutstage";
import { screenStage } from "./screenstage";
import type { Ctx, Scratch } from "./types";

/** Workflow's `step.do`, or a plain function call. Results must be JSON. */
export interface Steps {
  do<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

export const inline: Steps = { do: (_n, fn) => fn() };

export async function runCheck(ctx: Ctx, steps: Steps): Promise<void> {
  try {
    let s = await steps.do("pdf", () => runStep(ctx, "pdf", () => pdfStage(ctx)));
    const next = (key: string, stage: (c: Ctx, sc: Scratch) => Promise<import("./types").StageOut>) => {
      const from = s;
      return steps.do(key, () => runStep(ctx, key, () => stage(ctx, from)));
    };
    s = await next("screen", screenStage);
    s = await next("read_text", readTextStage);
    s = await next("read_image", readImageStage);
    s = await next("scout", scoutStage);
    s = await next("examine", examineStage);
    s = await next("gate", gateStage);
    s = await next("rationale", rationaleStage);
    await steps.do("finish", async () => {
      await finishRun(ctx);
      return true;
    });
  } catch (e) {
    await failRun(ctx, e);
    throw e;
  }
}
