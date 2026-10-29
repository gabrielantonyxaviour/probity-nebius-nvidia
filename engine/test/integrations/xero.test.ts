import { afterEach, describe, expect, it, vi } from "vitest";
import { syncXero, xeroAmountAtRisk, xeroDate } from "../../src/integrations/xero";
import { makeEnv, path, stubFetch } from "./harness";

afterEach(() => vi.unstubAllGlobals());

// Shapes follow Xero's documented Contacts and Invoices responses as Composio returns them (recorded by hand from the docs: no Xero account yet).
const contacts = { Contacts: [
  { ContactID: "c-1001", Name: "Kettle Point Data Cabling LLC", EmailAddress: "accounts@kettlepoint.example", ContactStatus: "ACTIVE", BankAccountDetails: "000999000412", Phones: [{ PhoneType: "DEFAULT", PhoneNumber: "5550142", PhoneAreaCode: "540", PhoneCountryCode: "1" }], Addresses: [{ AddressType: "STREET", AddressLine1: "88 Mill Race Rd", City: "Fredericksburg", Region: "VA", PostalCode: "22401" }] },
  { ContactID: "c-1002", Name: "Corbin Hollow HVAC Services LLC", ContactStatus: "ACTIVE", Phones: [], Addresses: [] },
] };
const bills = { Invoices: [
  { InvoiceID: "i-1", InvoiceNumber: "KP-2201", Type: "ACCPAY", Status: "AUTHORISED", AmountDue: 12450.5, CurrencyCode: "USD", DueDate: "/Date(1793318400000+0000)/", Contact: { ContactID: "c-1001" } },
  { InvoiceID: "i-2", InvoiceNumber: "KP-2208", Type: "ACCPAY", Status: "SUBMITTED", AmountDue: 3200, CurrencyCode: "USD", DueDate: "2026-11-12T00:00:00", Contact: { ContactID: "c-1001" } },
] };
const xeroTools = () => stubFetch([
  (u) => (path(u) === "/tools/execute/XERO_GET_CONTACTS" ? { successful: true, data: contacts } : undefined),
  (u) => (path(u) === "/tools/execute/XERO_LIST_INVOICES" ? { successful: true, data: JSON.stringify(bills) } : undefined), // some tools return the data as a JSON string
]);
const connect = (env: ReturnType<typeof makeEnv>) => env.d1.exec("INSERT INTO connections (org_id, provider, status, account, connected_account_id, updated_at) VALUES ('org_acme','xero','connected','Demo Company','ca_x','2026-10-30T00:00:00Z')");

describe("xero vendor master", () => {
  it("parses both Xero date forms", () => {
    expect(xeroDate("/Date(1793318400000+0000)/")).toBe("2026-10-30");
    expect(xeroDate("2026-11-12T00:00:00")).toBe("2026-11-12");
    expect(xeroDate(null)).toBeNull();
  });

  it("syncs contacts into the vendor tables with only the last four digits and a hash of the account", async () => {
    const env = makeEnv({ seed: true });
    connect(env);
    xeroTools();
    expect(await syncXero(env as never, "org_acme")).toEqual({ vendors: 2, bills: 2 });
    const v = await env.d1.prepare("SELECT vendor_id, legal_name, org_id, remit_city FROM vendors WHERE vendor_id = 'xero_c-1001'").first<Record<string, string>>();
    expect(v).toMatchObject({ legal_name: "Kettle Point Data Cabling LLC", org_id: "org_acme", remit_city: "Fredericksburg" });
    const acct = await env.d1.prepare("SELECT account_last4, account_hash FROM vendor_bank_accounts WHERE vendor_id = 'xero_c-1001'").first<Record<string, string>>();
    expect(acct?.account_last4).toBe("0412");
    expect(acct?.account_hash).toMatch(/^[0-9a-f]{64}$/);
    const dump = JSON.stringify(await env.d1.prepare("SELECT * FROM vendor_bank_accounts WHERE vendor_id LIKE 'xero_%'").all());
    expect(dump).not.toContain("000999000412");
    expect((await env.d1.prepare("SELECT value FROM vendor_contacts WHERE vendor_id = 'xero_c-1001' AND kind = 'phone'").first<{ value: string }>())?.value).toBe("+1 540 5550142");
    expect((await env.d1.prepare("SELECT domain FROM vendor_domains WHERE vendor_id = 'xero_c-1001'").first<{ domain: string }>())?.domain).toBe("kettlepoint.example");
    expect(await env.d1.prepare("SELECT 1 FROM vendor_bank_accounts WHERE vendor_id = 'xero_c-1002'").first()).toBeNull();
  });

  it("open bills give amount at risk and the next due date; the sync is cached for an hour", async () => {
    const env = makeEnv({ seed: true });
    connect(env);
    const log = xeroTools();
    const r = await xeroAmountAtRisk(env as never, "org_acme", "xero_c-1001");
    expect(r).toEqual({ cents: 1565050, nextDue: "2026-10-30", bills: 2 });
    const calls = log.length;
    await xeroAmountAtRisk(env as never, "org_acme", "xero_c-1001");
    expect(log.length).toBe(calls);
    expect(await xeroAmountAtRisk(env as never, "org_acme", "V-10027")).toBeNull(); // seeded vendors are not Xero's
  });

  it("a failing tool call records the error and leaves the master untouched", async () => {
    const env = makeEnv({ seed: true });
    connect(env);
    stubFetch([(u) => (path(u).startsWith("/tools/execute/") ? { successful: false, error: "token expired", data: {} } : undefined)]);
    expect(await syncXero(env as never, "org_acme")).toBeNull();
    expect(await env.d1.prepare("SELECT status, detail FROM xero_sync WHERE org_id = 'org_acme'").first()).toMatchObject({ status: "error" });
  });

  it("does nothing for a company without Xero", async () => {
    expect(await syncXero(makeEnv({ seed: true }) as never, "org_none")).toBeNull();
  });
});
