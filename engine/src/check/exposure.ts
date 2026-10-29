// What a vendor's pending payment would be, and when the next payment run is: from Xero when the company has it, else from our own tables.
import { DEMO_ORG_ID } from "@probity/shared";
import type { Env } from "../env";
import { xeroAmountAtRisk } from "../integrations";

export async function amountAtRisk(env: Env, orgId: string, vendorId: string): Promise<{ cents: number; nextRunAt: string | null }> {
  if (orgId !== DEMO_ORG_ID) {
    const x = await xeroAmountAtRisk(env, orgId, vendorId).catch(() => null);
    if (x) return { cents: x.cents, nextRunAt: x.nextDue };
  }
  const now = new Date().toISOString();
  const [sum, next] = await Promise.all([
    env.DB.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS cents FROM ap_invoices WHERE vendor_id = ?1 AND status IN ('open','approved','scheduled')").bind(vendorId).first<{ cents: number }>(),
    env.DB.prepare("SELECT cutoff_at FROM payment_runs WHERE cutoff_at > ?1 AND status != 'released' ORDER BY cutoff_at LIMIT 1").bind(now).first<{ cutoff_at: string }>(),
  ]);
  return { cents: sum?.cents ?? 0, nextRunAt: next?.cutoff_at ?? null };
}
