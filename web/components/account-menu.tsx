"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Me } from "@probity/shared";
import { account } from "@/lib/api";

/** Right side of the header: sign-in for visitors, the workspace and account menu for signed-in users. */
export function AccountMenu() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const path = usePathname();

  // Re-read on every navigation: signing in, creating or switching a workspace all change it.
  useEffect(() => {
    account.me().then(setMe).catch(() => setMe(null));
  }, [path]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  if (!me?.user) {
    return (
      <div className="row" style={{ gap: 8 }}>
        <Link href="/pricing" className="hdr-tag muted" style={{ textDecoration: "none", fontSize: 14, padding: "6px 8px" }}>Pricing</Link>
        <Link href="/signin" className="btn primary" style={{ minHeight: 34, padding: "0 12px", fontSize: 14 }}>Start free</Link>
      </div>
    );
  }

  async function switchTo(orgId: string) {
    await account.switchWorkspace(orgId);
    setOpen(false);
    router.refresh();
    window.location.assign("/");
  }
  async function signOut() {
    await account.signOut().catch(() => undefined);
    window.location.assign("/");
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className="btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" style={{ minHeight: 34, padding: "0 10px", fontSize: 14, maxWidth: 220 }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{me.org.name}</span>
        {me.org.plan === "pro" && <span className="chip info" style={{ fontSize: 9.5, padding: "0 6px" }}>Pro</span>}
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div role="menu" className="card rise" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", minWidth: 240, padding: 6, zIndex: 30, boxShadow: "0 8px 30px rgba(0,0,0,.14)" }}>
          <p className="muted" style={{ fontSize: 12.5, margin: "6px 10px 8px", overflowWrap: "anywhere" }}>{me.user.email}</p>
          <MenuLink href="/settings" onClick={() => setOpen(false)}>Settings and connections</MenuLink>
          <MenuLink href="/settings?tab=billing" onClick={() => setOpen(false)}>Plan and billing</MenuLink>
          {me.orgs.filter((o) => o.id !== me.org.id).length > 0 && <p className="label" style={{ margin: "10px 10px 4px", fontSize: 10 }}>Switch workspace</p>}
          {me.orgs.filter((o) => o.id !== me.org.id).map((o) => (
            <button key={o.id} role="menuitem" className="menu-item" onClick={() => switchTo(o.id)}>{o.name}</button>
          ))}
          <MenuLink href="/onboarding?new=1" onClick={() => setOpen(false)}>New company workspace</MenuLink>
          <div style={{ borderTop: "1px solid var(--rule)", margin: "6px 0" }} />
          <button role="menuitem" className="menu-item" onClick={signOut}>Sign out</button>
        </div>
      )}
      <style>{`.menu-item { display: block; width: 100%; text-align: left; background: none; border: 0; padding: 8px 10px; border-radius: 6px; font-size: 14px; cursor: pointer; text-decoration: none; color: var(--fg); }
        .menu-item:hover { background: var(--surface-2); }`}</style>
    </div>
  );
}

function MenuLink({ href, onClick, children }: { href: string; onClick: () => void; children: React.ReactNode }) {
  return <Link role="menuitem" href={href} onClick={onClick} className="menu-item">{children}</Link>;
}
