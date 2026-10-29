import type { Evidence, LetterReading, RequestDetail, Screen } from "@probity/shared";
import { z } from "zod";

/** Labels that the ledger (D1 lookups by the engine) and the gate agree on. Evidence is matched by field and these labels. */
export const LABEL = {
  accountOnOtherVendor: "Account already on another vendor",
  knownBad: "Known bad artefact",
  callbackConfirmed: "Call-back confirmed",
  phoneRecent: "Phone on file changed recently",
  phoneBefore: "Phone on file before the recent change",
} as const;

/** What the Identity Examiner (Ultra) concludes. The gate treats it as input, never as the decision. */
export const ExaminerOutput = z.object({
  entity: z.object({
    verdict: z.enum(["same", "related", "different", "ambiguous", "unclear"]),
    why: z.string(),
    evidenceIds: z.array(z.string()),
  }),
  address: z.object({
    verdict: z.enum(["unchanged", "on_file", "related_entity", "other_entity", "no_match", "unclear"]),
    why: z.string(),
    evidenceIds: z.array(z.string()),
  }),
  conflicts: z.array(z.object({ text: z.string(), evidenceIds: z.array(z.string()) })),
});
export type ExaminerOutput = z.infer<typeof ExaminerOutput>;

export const Pressure = z.object({ kind: z.enum(["urgency", "avoid_verification", "secrecy", "new_contact"]), quote: z.string() });
export type Pressure = z.infer<typeof Pressure>;

export interface GateInput {
  request: Pick<RequestDetail, "requestId" | "vendorId" | "vendorName" | "kind" | "senderEmail" | "amountAtRisk" | "nextRunAt" | "email" | "vendorOnFile" | "receivedAt">;
  letter: LetterReading;
  screen: Screen;
  evidence: Evidence[];
  examiner: ExaminerOutput | null;
  pressure: Pressure[];
  /** Phone numbers written anywhere in the letter text, formatted. */
  letterPhones: string[];
  /** Routing number exactly as read (not secret), and whether the two readings agreed on the account digits. */
  readingsDisagree: string[];
}
