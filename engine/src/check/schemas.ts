import { z } from "zod";
import { Pressure } from "../policy/types";

export const ClaimField = z.enum(["legal_name", "remit_address", "bank_name", "routing_number", "account_number", "phone", "email", "effective_date", "signatory", "other"]);
export const RawClaim = z.object({ field: ClaimField, value: z.string(), quote: z.string() });
export type RawClaim = z.infer<typeof RawClaim>;

export const TextReading = z.object({ claims: z.array(RawClaim), pressure: z.array(Pressure) });
export const ImageReading = TextReading.extend({ lines: z.array(z.string()) });
export type ImageReading = z.infer<typeof ImageReading>;

export const ScreenAnswer = z.object({ flagged: z.array(z.object({ id: z.number().int(), why: z.string() })) });
export const RationaleAnswer = z.object({ text: z.string() });
