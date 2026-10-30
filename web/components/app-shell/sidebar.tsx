"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import type { Me } from "@probity/shared";
import { account } from "@/lib/api";
import { Mark } from "@/components/landing/chrome";
import "./app-shell.css";

// The product's shell: a sidebar in the shape of an application sidebar block (workspace on top, grouped navigation,
// an upgrade card, the profile at the bottom left), and the page to its right. Below 900px it slides in from a top bar.
const ICON: Record<string, string> = {
  inbox: '<path d="M3 13h5l1.5 2.5h5L16 13h5"/><path d="M5.5 5h13L21 13v6H3v-6z"/>',
  upload: '<path d="M12 15V4m0 0-4 4m4-4 4 4"/><path d="M4 15v5h16v-5"/>',
  vendors: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5"/><circle cx="17" cy="9" r="2.3"/><path d="M16 14.6c2 .2 3.6 1.6 4.3 4.4"/>',
  runs: '<rect x="3.5" y="5" width="17" height="15" rx="1.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v4"/>',
  card: '<rect x="3" y="6" width="18" height="12" rx="1.5"/><path d="M3 10h18M7 15h4"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/>',
  tag: '<path d="M3 12V4h8l9 9-8 8z"/><circle cx="7.5" cy="8" r="1.4"/>',
};
const Icon = ({ name }: { name: string }) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICON[name] ?? "" }} />
);

type Item = { label: string; href: string; icon: string; match: (path: string, tab: string | null) => boolean };
const GROUPS: Array<{ label: string; items: Item[] }> = [
  { label: "Checks", items: [
    { label: "Inbox", href: "/app", icon: "inbox", match: (p) => p === "/app" || p.startsWith("/app/r/") },
    { label: "Check a letter", href: "/app/new", icon: "upload", match: (p) => p.startsWith("/app/new") },
  ] },
  { label: "Records", items: [
    { label: "Vendors", href: "/app/settings?tab=vendors", icon: "vendors", match: (p, t) => p === "/app/settings" && t === "vendors" },
    { label: "Payment runs", href: "/app/settings?tab=runs", icon: "runs", match: (p, t) => p === "/app/settings" && t === "runs" },
  ] },
  { label: "Workspace", items: [
    { label: "Connections", href: "/app/settings?tab=connections", icon: "plug", match: (p, t) => p === "/app/settings" && (!t || t === "connections") },
    { label: "Plan and billing", href: "/app/settings?tab=billing", icon: "card", match: (p, t) => p === "/app/settings" && t === "billing" },
  ] },
  { label: "Learn", items: [
    { label: "How it works", href: "/app/how", icon: "book", match: (p) => p.startsWith("/app/how") },
    { label: "Pricing", href: "/app/pricing", icon: "tag", match: (p) => p.startsWith("/app/pricing") },
  ] },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  return (
    <div className={`as${open ? " as-open" : ""}`}>
      <div className="as-mobilebar">
        <button className="as-burger" onClick={() => setOpen(true)} aria-label="Open navigation">☰</button>
        <Link href="/app" className="as-brand"><Mark size={24} /><span>Probity</span></Link>
      </div>
      <aside className="as-side" aria-label="Probity">
        <Suspense><SideNav /></Suspense>
      </aside>
      <button className="as-scrim" aria-label="Close navigation" onClick={() => setOpen(false)} />
      <div className="as-main">{children}</div>
    </div>
  );
}

function SideNav() {
  const path = usePathname();
  const tab = useSearchParams().get("tab");
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => { account.me().then(setMe).catch(() => setMe(null)); }, [path]);
  return (
    <>
      <div className="as-top">
        <Link href="/app" className="as-brand"><Mark size={24} /><span>Probity</span></Link>
      </div>
      <nav className="as-nav">
        {GROUPS.map((g) => (
          <div key={g.label} className="as-group">
            <p className="as-glabel">{g.label}</p>
            {g.items.map((it) => {
              const on = it.match(path, tab);
              return (
                <Link key={it.label} href={it.href} className={`as-item${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>
                  <Icon name={it.icon} /><span>{it.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="as-bottom">
        {me?.user && !me.org.isDemo && me.org.plan !== "pro" && (
          <div className="as-promo">
            <b>Probity Plus</b>
            <span>1,000 checks a month for teams that pay vendors every week.</span>
            <Link href="/app/settings?tab=billing">Upgrade</Link>
          </div>
        )}
        <Profile me={me} />
      </div>
    </>
  );
}

function useOutside(onOut: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOut(); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [onOut]);
  return ref;
}

function Profile({ me }: { me: Me | null }) {
  const [open, setOpen] = useState(false);
  const ref = useOutside(() => setOpen(false));
  if (!me?.user) return <div className="as-profile as-skel" />;
  const email = me.user.email;
  const name = me.user.name && me.user.name !== email ? me.user.name : email.split("@")[0];
  const workspace = me.org.isDemo ? "Demo company" : me.org.name;
  const others = me.orgs.filter((o) => o.id !== me.org.id);
  async function switchTo(orgId: string) {
    await account.switchWorkspace(orgId);
    window.location.assign("/app");
  }
  async function signOut() {
    await account.signOut().catch(() => undefined);
    window.location.assign("/");
  }
  return (
    <div ref={ref} className="as-pwrap">
      {open && (
        <div role="menu" className="as-menu up">
          <p className="as-menulabel">{email}</p>
          <p className="as-menulabel" style={{ marginTop: 8 }}>Workspaces</p>
          <span className="as-menuitem current">{workspace} ✓</span>
          {others.map((o) => <button key={o.id} role="menuitem" className="as-menuitem" onClick={() => switchTo(o.id)}>{o.name}</button>)}
          <Link role="menuitem" className="as-menuitem" href="/app/onboarding?new=1">+ New company workspace</Link>
          <div className="as-sep" />
          <Link role="menuitem" className="as-menuitem" href="/app/settings?tab=billing">Plan and billing</Link>
          <Link role="menuitem" className="as-menuitem" href="/">Probity website</Link>
          <button role="menuitem" className="as-menuitem danger" onClick={signOut}>Sign out</button>
        </div>
      )}
      <button className="as-profile" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <span className="as-avatar">{name.slice(0, 1).toUpperCase()}</span>
        <span className="as-pname"><b>{name}</b><span>{workspace} · {me.org.plan === "pro" ? "Probity Plus" : "Free"}</span></span>
        <span aria-hidden="true" className="as-chev">⋯</span>
      </button>
    </div>
  );
}
