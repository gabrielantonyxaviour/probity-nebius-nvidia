// OpenAI-format tool definitions the Registry Scout agent can call. Handlers live in index.ts; names must match `ScoutToolName`.
export type ScoutToolName = "edgar_lookup" | "usaspending_lookup" | "gleif_lookup" | "vendor_master" | "web_contact_lookup";

type Tool = { type: "function"; function: { name: ScoutToolName; description: string; parameters: Record<string, unknown> } };

const name = { type: "string", description: "The company's legal name as printed in the letter or held by the vendor master, e.g. \"Booz Allen Hamilton Inc.\"" };

export const scoutTools: Tool[] = [
  {
    type: "function",
    function: {
      name: "edgar_lookup",
      description: "SEC EDGAR registry for a listed (public) company: registered legal name, business phone, business and mailing address, website and former names. Free. Private companies are not in EDGAR. This is an independent source for a call-back phone number.",
      parameters: { type: "object", properties: { name, cik: { type: "string", description: "Central Index Key, if already known (digits)." } }, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "usaspending_lookup",
      description: "USAspending.gov federal award recipient registry: Unique Entity ID, legal name, address, parent company and alternate names. No phone numbers. Free. Use it to confirm which legal entity exists and where it is located.",
      parameters: { type: "object", properties: { name }, required: ["name"], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "gleif_lookup",
      description: "GLEIF Legal Entity Identifier registry: LEI, legal address, headquarters address and registration number. No phone numbers. Free.",
      parameters: { type: "object", properties: { name }, required: ["name"], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "vendor_master",
      description: "The payer's own vendor master: legal name, remit-to address, bank account on file (masked), phone and e-mail domain on file, and remit address history. Always call this first; it is what the request is compared against.",
      parameters: { type: "object", properties: { vendorId: { type: "string", description: "Vendor id such as V-10027." } }, required: ["vendorId"], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "web_contact_lookup",
      description: "Paid web search for the company's own official website and the phone number on its contact page. Costs credits from a small shared budget: call it only when the registries returned no phone number or no domain, and at most once per check.",
      parameters: { type: "object", properties: { company: { type: "string", description: "Company legal name." }, domainHint: { type: "string", description: "The vendor's known e-mail domain from the vendor master, if any." } }, required: ["company"], additionalProperties: false },
    },
  },
];
