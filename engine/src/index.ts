// probity-engine: the Hono API, the check Workflow and B's scheduled sweep trigger.
import { Hono } from "hono";
import type { Env } from "./env";
import { authRoutes, tenant } from "./auth";
import { billingRoutes } from "./billing";
import { integrationRoutes } from "./integrations";
import { makeOpsRoutes, scheduled } from "./ops";
import { fileRoutes } from "./routes/files";
import { inboxRoutes } from "./routes/inbox";
import { runRoutes } from "./routes/runs";
import { session } from "./routes/session";
import { startRoutes } from "./routes/start";
import { uploadRoutes } from "./routes/upload";
import { vendorRoutes } from "./routes/vendors";
import type { AppEnv } from "./routes/util";

const app = new Hono<AppEnv>();
app.use("*", session);
app.use("*", tenant);
// Module mounts. Each module owns everything under its prefix; this file changes only through the coordinator.
app.route("/api", authRoutes); // C: /api/auth/*, /api/me, /api/workspaces*
app.route("/api/billing", billingRoutes); // C
app.route("/api", integrationRoutes); // B: /api/connections*, /api/hooks/*, /api/schedule
app.route("/", inboxRoutes);
app.route("/", startRoutes);
app.route("/", uploadRoutes);
app.route("/", vendorRoutes);
app.route("/", runRoutes);
app.route("/", fileRoutes);
// B's ops routes read the session from this engine's pb_sid cookie, set by the session middleware above.
app.route("/api", makeOpsRoutes((c) => (c as unknown as { get(k: string): string }).get("sid")));
app.notFound((c) => c.json({ error: "Not found.", code: "not_found" }, 404));
app.onError((_e, c) => c.json({ error: "Something went wrong on our side. Try again.", code: "internal" }, 500));

export { CheckWorkflow } from "./workflow/check-workflow";

export default {
  fetch: app.fetch,
  scheduled,
} satisfies ExportedHandler<Env>;
