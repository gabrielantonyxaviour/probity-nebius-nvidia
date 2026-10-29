// Billing module (Sonnet C): Dodo Payments checkout, portal, webhook and the judge code. Mounted at /api/billing.
import { Hono } from "hono";
import type { AppEnv } from "../routes/util";

export const billingRoutes = new Hono<AppEnv>();
