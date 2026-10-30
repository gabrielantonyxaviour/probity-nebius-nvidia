import { AppShell } from "@/components/app-shell/sidebar";
import { SessionGuard } from "@/components/session-guard";

/** The product: the sidebar shell around every page under /app. The landing page at / has its own chrome. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SessionGuard />
      <AppShell>
        <main>{children}</main>
      </AppShell>
    </>
  );
}
