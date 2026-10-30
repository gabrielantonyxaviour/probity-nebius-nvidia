import Link from "next/link";
import { AccountMenu } from "./account-menu";
import { NavLinks } from "./nav-links";

export function SiteHeader() {
  return (
    <header
      style={{
        position: "sticky", top: 0, zIndex: 20, borderBottom: "1px solid var(--rule)",
        background: "color-mix(in srgb, var(--bg) 86%, transparent)", backdropFilter: "blur(10px)",
      }}
    >
      <div className="wrap between" style={{ minHeight: 58, flexWrap: "wrap", rowGap: 6, paddingTop: 6, paddingBottom: 6 }}>
        <div className="row hdr-left" style={{ gap: 22 }}>
          <Link href="/app" className="row" style={{ textDecoration: "none", gap: 9 }} aria-label="Probity inbox">
            <Mark />
            <span className="serif" style={{ fontSize: 23, lineHeight: 1 }}>Probity</span>
          </Link>
          <NavLinks />
        </div>
        <div className="row" style={{ gap: 14 }}>
          <span className="label hdr-tag" style={{ fontSize: 10.5 }} title="Every model call runs on NVIDIA Nemotron through Nebius Token Factory">
            NVIDIA Nemotron · Nebius
          </span>
          <AccountMenu />
        </div>
      </div>
      <style>{`@media (max-width: 600px) { .hdr-tag { display: none; } .hdr-left { gap: 10px !important; } } @media (max-width: 900px) { .hdr-tag { display: none; } }`}</style>
    </header>
  );
}

function Mark() {
  // The record on file and the letter, overlapping; the crimson overlap is where they must line up.
  return (
    <svg width="26" height="20" viewBox="2 9 60 46" aria-hidden="true">
      <path d="M30 26h9v7a5 5 0 0 1-5 5H25V31a5 5 0 0 1 5-5z" fill="var(--mark-accent)" />
      <rect x="7" y="14" width="32" height="24" rx="5" fill="none" stroke="currentColor" strokeWidth="4.5" />
      <rect x="25" y="26" width="32" height="24" rx="5" fill="none" stroke="currentColor" strokeWidth="4.5" />
    </svg>
  );
}
