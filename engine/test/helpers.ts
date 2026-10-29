import type { Evidence } from "@probity/shared";
import type { GateInput } from "../src/policy/types";

export const ev = (id: string, source: Evidence["source"], field: Evidence["field"], label: string, value: string): Evidence => ({
  id, source, field, label, value, url: null, retrievedAt: "2026-10-22T12:00:00Z", cached: false,
});

export const EDGAR_PHONE = ev("ev-sec_edgar-aaaaaa", "sec_edgar", "phone", "Registered business phone (SEC)", "(321) 727-9100");
export const DOMAIN = ev("ev-vendor_master-dddddd", "vendor_master", "domain", "E-mail domain on file", "l3harris.example");

/** A clean L3Harris-style bank change: right domain, right name, address unchanged, independent phone available. */
export function clean(over: Partial<GateInput> = {}): GateInput {
  return {
    request: {
      requestId: "BCR-2026-0398", vendorId: "V-10198", vendorName: "L3Harris Technologies, Inc.", kind: "bank_change", senderEmail: "treasury@l3harris.example",
      amountAtRisk: { cents: 4_821_000, currency: "USD" }, nextRunAt: "2026-10-30T18:00:00Z", receivedAt: "2026-10-20T14:05:00Z",
      email: { from: '"K. Albrecht" <treasury@l3harris.example>', replyTo: null, subject: "Change of bank account", received: "2026-10-20T14:05:00Z", spf: "pass", dkim: "pass" },
      vendorOnFile: { legalName: "L3Harris Technologies, Inc.", remitAddress: "1395 Troutman Blvd NE, Palm Bay, FL 32905", phone: "(321) 727-9100", domain: "l3harris.example", accountMasked: "••••0501" },
    },
    letter: {
      pageCount: 1, pageImages: ["pages/r/1.png"], pageSize: [612, 792], hidden: [], scanned: false,
      claims: [
        { field: "legal_name", value: "L3Harris Technologies, Inc.", quote: "L3Harris Technologies, Inc.", inImage: true },
        { field: "bank_name", value: "Calderwick Savings Bank", quote: "Calderwick Savings Bank", inImage: true },
        { field: "routing_number", value: "110000000", quote: "110000000", inImage: true },
        { field: "account_number", value: "••••0731", quote: "••••0731", inImage: true },
        { field: "other", value: "Account holder: L3Harris Technologies, Inc.", quote: "Account name L3Harris Technologies, Inc.", inImage: true },
        { field: "signatory", value: "K. Albrecht", quote: "K. Albrecht", inImage: true },
        { field: "phone", value: "(321) 555-0100", quote: "(321) 555-0100", inImage: true },
      ],
    },
    screen: { spansScreened: 30, flags: [] },
    evidence: [EDGAR_PHONE, DOMAIN],
    examiner: { entity: { verdict: "same", why: "Same registrant.", evidenceIds: [] }, address: { verdict: "unchanged", why: "No change.", evidenceIds: [] }, conflicts: [] },
    pressure: [],
    letterPhones: ["(321) 555-0100"],
    readingsDisagree: [],
    ...over,
  };
}
