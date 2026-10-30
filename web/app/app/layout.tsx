import { AppShell } from "@/components/app-shell/sidebar";
import { SessionGuard } from "@/components/session-guard";

/** The product: the sidebar shell around every page under /app. The landing page at / has its own chrome. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SessionGuard />
      <AppShell>
        <main>{children}</main>
        <footer className="wrap" style={{ padding: "40px var(--gutter) 0", color: "var(--muted)", fontSize: 12.5 }}>
          <div style={{ borderTop: "1px solid var(--rule)", paddingTop: 16 }}>
            The demo company, its vendors and its letters are synthetic. Connected mailboxes, Xero and Slack, registry facts and web results are real.
          </div>
        </footer>
      </AppShell>
    </>
  );
}
