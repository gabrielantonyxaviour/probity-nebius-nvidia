import type { Claim, ModelCall, RequestDetail, Run } from "@probity/shared";
import type { Env } from "../env";
import type { LetterLine, PdfiumWasm } from "../pdf";
import type { ExaminerOutput, Pressure } from "../policy/types";

/** Where runs live. D1 in the Worker, a Map in tests. */
export interface RunStore {
  get(runId: string): Promise<Run>;
  /** Applies `fn` to the stored run and writes it back. Steps run one after another, so there is no write race. */
  update(runId: string, fn: (run: Run) => void): Promise<Run>;
}

/** Letter PDFs and page images. R2 in the Worker, memory in tests. */
export interface FileStore {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

export interface Ctx {
  env: Env;
  runId: string;
  sessionId: string;
  orgId: string;
  store: RunStore;
  files: FileStore;
  wasm: PdfiumWasm;
}

export type RequestFacts = Pick<RequestDetail, "requestId" | "vendorId" | "vendorName" | "kind" | "senderEmail" | "amountAtRisk" | "nextRunAt" | "email" | "vendorOnFile" | "receivedAt">;

/** Everything one step hands the next. JSON only: it is stored by the Workflow between steps. */
export interface Scratch {
  request: RequestFacts;
  emlText: string;
  lines: LetterLine[];
  letterPhones: string[];
  /** ids of letter lines the screen flagged: withheld from every later prompt */
  withheld: string[];
  claims: Claim[];
  pressure: Pressure[];
  /** sha256("routing:account") and last four digits of the account as read from the text layer, if any */
  textAccount: { hash: string; digitsHash: string; last4: string } | null;
  readingsDisagree: string[];
  examiner: ExaminerOutput | null;
  pageKeys: string[];
}

export type StageOut = { scratch: Scratch; summary: string; calls?: ModelCall[]; skipped?: boolean };
