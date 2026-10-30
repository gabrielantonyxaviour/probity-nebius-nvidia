import { describe, expect, it } from "vitest";
import { domainsOf, parseCsv, readHeader } from "../src/vendors/csv";
import { prepare } from "../src/vendors/import";

describe("csv reader", () => {
  it("handles quoted commas, escaped quotes and line breaks inside quotes", () => {
    expect(parseCsv('name,domain\n"Acme, Inc.","acme.com"\n"Say ""hi"" Co","a.com"\n"Two\nLines",b.com')).toEqual([
      ["name", "domain"], ["Acme, Inc.", "acme.com"], ['Say "hi" Co', "a.com"], ["Two\nLines", "b.com"],
    ]);
  });
  it("reads CRLF, bare CR, a BOM, blank lines and a missing final newline", () => {
    expect(parseCsv("﻿name,phone\r\nA,1\r\n\r\nB,2\rC,3")).toEqual([["name", "phone"], ["A", "1"], ["B", "2"], ["C", "3"]]);
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n\n,\n")).toEqual([]);
  });
  it("keeps empty cells and a trailing empty cell", () => {
    expect(parseCsv("a,b,c\n1,,\n,2,")).toEqual([["a", "b", "c"], ["1", "", ""], ["", "2", ""]]);
  });
  it("matches header names loosely and needs a name column", () => {
    expect(readHeader(["Vendor Name", "E-mail domain", "Routing Number"])).toEqual({ name: 0, domain: 1, routing: 2 });
    expect(readHeader(["domain", "phone"])).toBeNull();
  });
  it("reduces a domain cell to hosts", () => {
    expect(domainsOf("AP@Acme.com; https://www.beta.io/x, gamma.org")).toEqual(["acme.com", "beta.io", "gamma.org"]);
    expect(domainsOf("")).toEqual([]);
  });
  it("turns rows into vendors or row-numbered reasons (row 1 is the header)", () => {
    const p = prepare('name,domain,phone,bank_name,routing,account\nAcme Supply LLC,acme.com,(757) 555-0190,Calderwick,110000000,"0000 1234 5678"\n,x.com,,,,\nBad Domain Co,not a domain,,,,\nShort Routing,s.com,,Bank,1234,99999999\n');
    if (!p.ok) throw new Error("expected ok");
    expect(p.rows.map((r) => r.row)).toEqual([2]);
    expect(p.rows[0]!.input.bank).toMatchObject({ routing: "110000000", account: "000012345678" });
    expect(p.skipped).toEqual([
      { row: 3, reason: "name: The legal name needs at least 2 characters." },
      { row: 4, reason: expect.stringMatching(/^domain:/) },
      { row: 5, reason: "routing: The routing number is 9 digits." },
    ]);
  });
  it("refuses a file with no name column or too many rows", () => {
    expect(prepare("domain\nacme.com")).toMatchObject({ ok: false, code: "bad_csv" });
    expect(prepare(`name\n${Array.from({ length: 501 }, (_, i) => `Vendor ${i}`).join("\n")}`)).toMatchObject({ ok: false, code: "too_many_rows" });
    expect(prepare(`name\n${Array.from({ length: 500 }, (_, i) => `Vendor ${i}`).join("\n")}`)).toMatchObject({ ok: true });
  });
});
