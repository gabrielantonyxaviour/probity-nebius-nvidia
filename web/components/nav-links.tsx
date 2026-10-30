"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/app", label: "Inbox", short: "Inbox", match: (p: string) => p === "/app" || p.startsWith("/app/r/") },
  { href: "/app/new", label: "Check a letter", short: "Check", match: (p: string) => p.startsWith("/app/new") },
  { href: "/how", label: "How it works", short: "How", match: (p: string) => p.startsWith("/how") },
];

export function NavLinks() {
  const path = usePathname() ?? "/";
  return (
    <nav aria-label="Main" className="row" style={{ gap: 4 }}>
      {LINKS.map((l) => {
        const on = l.match(path);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={on ? "page" : undefined}
            style={{
              textDecoration: "none", padding: "6px 9px", borderRadius: 7, fontSize: 14, whiteSpace: "nowrap",
              color: on ? "var(--fg)" : "var(--muted)", background: on ? "var(--surface-2)" : "transparent",
            }}
          >
            <span className="nav-long">{l.label}</span><span className="nav-short">{l.short}</span>
          </Link>
        );
      })}
      <style>{`.nav-short { display: none; } @media (max-width: 440px) { .nav-long { display: none; } .nav-short { display: inline; } }`}</style>
    </nav>
  );
}
