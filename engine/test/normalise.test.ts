import { describe, expect, it } from "vitest";
import { addressesMatch, formatPhone, lookalikeOf, maskAccount, maskAccountsIn, phonesIn, registrable, sameName, validAba } from "../src/policy/normalise";

describe("normalise", () => {
  it("matches company names across suffixes and punctuation", () => {
    expect(sameName("L3Harris Technologies, Inc.", "L3HARRIS TECHNOLOGIES INC")).toBe(true);
    expect(sameName("Booz Allen Hamilton Inc", "Booz Allen Hamilton Holding")).toBe(false);
    expect(sameName("V2X, Inc. (formerly Vectrus, Inc.)", "V2X, Inc.")).toBe(true);
  });
  it("finds the domain a sender imitates", () => {
    expect(lookalikeOf("boozallen-payments.example", ["boozallen.example"])).toBe("boozallen.example");
    expect(lookalikeOf("finance.sableharbor.example", ["sableharbor.example"])).toBeNull();
    expect(registrable("mail.corp.co.uk")).toBe("corp.co.uk");
  });
  it("matches addresses through abbreviations and a missing zip", () => {
    expect(addressesMatch("8283 Greensboro Drive, McLean, VA 22102", "8283 Greensboro Dr, McLean, VA 22102")).toBe(true);
    expect(addressesMatch("1395 Troutman Boulevard NE, Palm Bay, FL", "1395 Troutman Blvd NE, Palm Bay, FL 32905")).toBe(true);
    expect(addressesMatch("1 Commvault Way, Suite 205, Tinton Falls, NJ 07724", "8283 Greensboro Dr, McLean, VA 22102")).toBe(false);
  });
  it("formats and finds phone numbers", () => {
    expect(formatPhone("+1 703 902 5000")).toBe("(703) 902-5000");
    expect(phonesIn("Call (703) 555-0147 or 757-555-0125.")).toEqual(["(703) 555-0147", "(757) 555-0125"]);
  });
  it("masks account numbers", () => {
    expect(maskAccount("000999000731")).toBe("••••0731");
    expect(maskAccountsIn("000999000731 TEST ACCOUNT")).toBe("••••0731 TEST ACCOUNT");
  });
  it("validates ABA checksums", () => {
    expect(validAba("110000000")).toBe(true);
    expect(validAba("110000001")).toBe(false);
    expect(validAba("11000000")).toBe(false);
  });
});
