// Integrations module (Sonnet B): connections (Composio: Gmail, Outlook, Xero; our own Slack app), webhooks, schedule.
// Mounted at /api: /connections/*, /hooks/*, /schedule.
import { Hono } from "hono";
import type { AppEnv } from "../routes/util";
import { connectionRoutes } from "./connections";
import { hookRoutes } from "./hooks";
import { scheduleRoutes } from "./schedule";
import { slackRoutes } from "./slack";

export const integrationRoutes = new Hono<AppEnv>();
integrationRoutes.route("/", connectionRoutes);
integrationRoutes.route("/", hookRoutes);
integrationRoutes.route("/", slackRoutes);
integrationRoutes.route("/", scheduleRoutes);

export { notifyRunFinished } from "./slack";
export { runDueRechecks } from "./schedule";
export { syncXero, xeroAmountAtRisk } from "./xero";
