// The company's vendor list: read it, add a vendor, import a CSV, copy the sample vendors, remove one. Everything is scoped to the active company.
import { ImportResult, SamplesResult, VendorInput } from "@probity/shared";
import { Hono } from "hono";
import { requireAdmin } from "../integrations/access";
import { copySamples } from "../vendors/samples";
import { importVendors, MAX_BYTES, prepare, reason } from "../vendors/import";
import { flush, hasName, HIDDEN, listVendors, MAX_VENDORS, vendorCount, vendorNames, vendorStatements } from "../vendors/store";
import { fail, type AppEnv } from "./util";

const ID = /^[A-Za-z0-9_.-]{3,80}$/;

export const vendorRoutes = new Hono<AppEnv>()
  .get("/api/vendors", async (c) => c.json(await listVendors(c.env, c.get("orgId"))))

  .post("/api/vendors", requireAdmin, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = VendorInput.safeParse(body);
    if (!parsed.success) return fail(c, 400, reason(parsed.error.issues[0]!), "invalid");
    const org = c.get("orgId");
    if (hasName(await vendorNames(c.env, org), parsed.data.legalName)) return fail(c, 409, "You already have a vendor with that name.", "duplicate");
    if ((await vendorCount(c.env, org)) >= MAX_VENDORS) return fail(c, 422, `Your vendor list is full (${MAX_VENDORS}).`, "limit_reached");
    const { vendor, stmts } = await vendorStatements(c.env, org, parsed.data, new Date().toISOString());
    await flush(c.env, [stmts]);
    return c.json(vendor, 201);
  })

  .post("/api/vendors/import", requireAdmin, async (c) => {
    const declared = Number(c.req.header("content-length") ?? 0);
    if (declared > MAX_BYTES * 2) return fail(c, 413, "That file is too large. Import at most 200 KB (500 vendors) at a time.", "too_large");
    const raw = await c.req.text().catch(() => "");
    let csv = raw;
    if ((c.req.header("content-type") ?? "").includes("json")) {
      try {
        const j = JSON.parse(raw) as { csv?: unknown };
        if (typeof j?.csv !== "string") throw new Error("shape");
        csv = j.csv;
      } catch { return fail(c, 400, "Send the CSV as text/csv or as JSON like { \"csv\": \"...\" }.", "bad_request"); }
    }
    if (new TextEncoder().encode(csv).length > MAX_BYTES) return fail(c, 413, "That file is too large. Import at most 200 KB (500 vendors) at a time.", "too_large");
    if (!csv.trim()) return fail(c, 400, "The CSV is empty.", "bad_csv");
    const prepared = prepare(csv);
    if (!prepared.ok) return fail(c, prepared.code === "too_many_rows" ? 422 : 400, prepared.error, prepared.code);
    return c.json(ImportResult.parse(await importVendors(c.env, c.get("orgId"), prepared.rows, prepared.skipped, new Date().toISOString())));
  })

  .post("/api/vendors/samples", requireAdmin, async (c) => c.json(SamplesResult.parse(await copySamples(c.env, c.get("orgId"), new Date().toISOString()))))

  .delete("/api/vendors/:id", requireAdmin, async (c) => {
    const id = c.req.param("id");
    const org = c.get("orgId");
    if (!ID.test(id)) return fail(c, 400, "That vendor id is not valid.", "bad_id");
    const v = await c.env.DB.prepare(`SELECT vendor_id, source FROM vendors WHERE vendor_id = ?1 AND org_id = ?2 AND status NOT IN ${HIDDEN}`).bind(id, org).first<{ vendor_id: string; source: string }>();
    if (!v) return fail(c, 404, "Vendor not found.", "not_found");
    if (v.source === "xero") return fail(c, 409, "This vendor comes from Xero. Remove it in Xero and it will drop off at the next sync.", "xero_managed");
    const used = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM requests WHERE vendor_id = ?1 AND org_id = ?2").bind(id, org).first<{ n: number }>();
    if ((used?.n ?? 0) > 0) return fail(c, 409, "This vendor has checks on file, so it stays in your list.", "in_use");
    const mine = "vendor_id IN (SELECT vendor_id FROM vendors WHERE vendor_id = ?1 AND org_id = ?2)";
    const del = (t: string) => c.env.DB.prepare(`DELETE FROM ${t} WHERE ${mine}`).bind(id, org);
    await c.env.DB.batch([...["vendor_domains", "vendor_contacts", "vendor_bank_accounts", "vendor_remit_history", "ap_invoices", "payment_run_items"].map(del), c.env.DB.prepare("DELETE FROM vendors WHERE vendor_id = ?1 AND org_id = ?2").bind(id, org)]);
    return c.json({ ok: true });
  });
