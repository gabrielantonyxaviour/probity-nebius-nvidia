// Integrations module (Sonnet B): connections (Composio: Gmail, Outlook, Xero; our own Slack app), webhooks, schedule.
// Mounted at /api: /connections/*, /hooks/*, /schedule.
import { Hono } from "hono";
import type { AppEnv } from "../routes/util";

export const integrationRoutes = new Hono<AppEnv>();
