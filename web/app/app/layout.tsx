import { SessionGuard } from "@/components/session-guard";
import { SiteHeader } from "@/components/site-header";

/** The product: header, page, and the synthetic-data footer. The landing page at / has its own chrome. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SessionGuard />
      <SiteHeader />
      <main>{children}</main>
      <footer className="wrap" style={{ padding: "48px var(--gutter) 40px", color: "var(--muted)", fontSize: 13 }}>
        <div className="between" style={{ flexWrap: "wrap", borderTop: "1px solid var(--rule)", paddingTop: 18 }}>
          <span>
            The demo company, its vendors and its letters are synthetic. Connected mailboxes, Xero and Slack, registry facts and web results are real.
          </span>
          <span className="row" style={{ gap: 14, fontSize: 13 }}><a href="/pricing">Pricing</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><span className="mono">MIT licence</span></span>
        </div>
      </footer>
    </>
  );
}
