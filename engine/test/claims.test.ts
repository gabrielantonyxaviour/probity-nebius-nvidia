import { describe, expect, it } from "vitest";
import { accountOf, collapseRuns, sameClaimValue, toClaims } from "../src/check/claims";
import type { RawClaim } from "../src/check/schemas";

const raw: RawClaim[] = [
  { field: "routing_number", value: "110000000 TEST ROUTING", quote: "Routing number 110000000 TEST ROUTING" },
  { field: "account_number", value: "000999000731", quote: "Account number 000999000731 TEST ACCOUNT" },
  { field: "remit_address", value: "unchanged", quote: "Our remit-to address is unchanged." },
  { field: "legal_name", value: "Invented Corp", quote: "Invented Corp" },
];
const text = "Routing number 110000000 TEST ROUTING\nAccount number 000999000731 TEST ACCOUNT\nOur remit-to address is unchanged.";

describe("claims", () => {
  const claims = toClaims(raw, text, false);
  it("never keeps a full account number, in the value or the quote, but leaves the routing number alone", () => {
    expect(JSON.stringify(claims)).not.toContain("000999000731");
    expect(claims.find((c) => c.field === "account_number")).toMatchObject({ value: "••••0731", quote: "Account number ••••0731 TEST ACCOUNT" });
    expect(claims.find((c) => c.field === "routing_number")).toMatchObject({ value: "110000000", quote: "Routing number 110000000 TEST ROUTING" });
  });
  it("drops quotes that are not in the letter and 'unchanged' as an address", () => {
    expect(claims.map((c) => c.field).sort()).toEqual(["account_number", "routing_number"]);
  });
  it("drops a misread routing number when a valid one was read", () => {
    const c = toClaims([{ field: "routing_number", value: "110000000", quote: "x" }, { field: "routing_number", value: "11000000", quote: "x" }], null, true);
    expect(c.map((x) => x.value)).toEqual(["110000000"]);
  });
  it("hashes the account like the vendor master and compares readings tolerant of a dropped zero only", async () => {
    const a = await accountOf(raw);
    expect(a).toMatchObject({ last4: "0731", routing: "110000000" });
    expect(a!.hash).toMatch(/^[0-9a-f]{64}$/);
    const dropped = await accountOf([{ field: "account_number", value: "00999000731", quote: "" }]);
    const swapped = await accountOf([{ field: "account_number", value: "000999000713", quote: "" }]);
    expect(dropped!.digitsHash).toBe(a!.digitsHash);
    expect(swapped!.digitsHash).not.toBe(a!.digitsHash);
    expect(collapseRuns("000999000731")).toBe("090731");
  });
  it("compares claim values by digits for numbers and by words for text", () => {
    expect(sameClaimValue("phone", "(703) 555-0147", "703-555-0147")).toBe(true);
    expect(sameClaimValue("legal_name", "Booz Allen Hamilton Inc.", "Booz Allen Hamilton Inc")).toBe(true);
    expect(sameClaimValue("legal_name", "Booz Allen", "Leidos Inc")).toBe(false);
  });
});
