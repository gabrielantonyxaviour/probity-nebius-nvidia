// The policy gate. Pure code: facts in, decision out. A model can add evidence and wording, never change the verdict.
import { POLICY_VERSION, type Decision, type Outcome, type Reason, type Verdict } from "@probity/shared";
import { buildCallCard } from "./callcard";
import { accountReasons, addressReasons, conductReasons, disguiseReasons, domainReasons, entityReasons, textReasons } from "./rules";
import { LABEL, type GateInput } from "./types";

const ORDER = { hold: 0, callback: 1, info: 2 } as const;

/** A confirmed call-back to an independent number, already on record for this request. */
export const callbackOnRecord = (i: GateInput) => i.evidence.some((e) => e.label === LABEL.callbackConfirmed);

export function computeReasons(i: GateInput): Reason[] {
  const card = buildCallCard(i);
  const rs: Reason[] = [
    ...domainReasons(i),
    ...entityReasons(i),
    ...addressReasons(i),
    ...accountReasons(i),
    ...textReasons(i),
    ...disguiseReasons(i),
    ...conductReasons(i),
  ];
  if (!callbackOnRecord(i)) rs.push({ code: "C1", severity: "callback", text: "No call-back to an independent number is on record for this request.", evidenceIds: [] });
  if (!card.phone && !callbackOnRecord(i))
    rs.push({ code: "C9", severity: "callback", text: `No independent phone number was found for ${i.request.vendorName}. Escalate to the contracting officer for a verified contact.`, evidenceIds: [] });
  // Text aimed at an automated reviewer leads: it is the finding a clerk cannot see for themselves.
  const lead = (r: Reason) => (r.code === "H10" ? -1 : 0);
  return rs.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || lead(a) - lead(b));
}

export const verdictOf = (reasons: Reason[]): Verdict =>
  reasons.some((r) => r.severity === "hold") ? "HOLD" : reasons.some((r) => r.severity === "callback") ? "CALLBACK_VERIFY" : "APPROVE";

/** The decision without its rationale; the rationale step fills `rationale` and `rationaleChecked`. */
export function gate(i: GateInput): Decision {
  const reasons = computeReasons(i);
  const verdict = verdictOf(reasons);
  return {
    verdict,
    finalVerdict: verdict,
    reasons,
    rationale: "",
    rationaleChecked: false,
    callCard: buildCallCard(i),
    policyVersion: POLICY_VERSION,
    outcome: null,
  };
}

/** confirmed + CALLBACK_VERIFY -> APPROVE; denied -> HOLD; no answer changes nothing; a HOLD stays a HOLD. */
export function finalVerdictFor(verdict: Verdict, outcome: Outcome | null): Verdict {
  if (!outcome || verdict === "HOLD") return verdict;
  if (outcome.result === "denied") return "HOLD";
  if (outcome.result === "confirmed" && verdict === "CALLBACK_VERIFY") return "APPROVE";
  return verdict;
}

export function applyOutcome(d: Decision, outcome: Outcome): Decision {
  return { ...d, outcome, finalVerdict: finalVerdictFor(d.verdict, outcome) };
}
