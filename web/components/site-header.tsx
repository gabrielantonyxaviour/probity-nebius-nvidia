import Link from "next/link";
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
          <Link href="/" className="row" style={{ textDecoration: "none", gap: 9 }} aria-label="Probity inbox">
            <Mark />
            <span className="serif" style={{ fontSize: 23, lineHeight: 1 }}>Probity</span>
          </Link>
          <NavLinks />
        </div>
        <span className="label hdr-tag" style={{ fontSize: 10.5 }} title="Every model call runs on NVIDIA Nemotron through Nebius Token Factory">
          NVIDIA Nemotron · Nebius
        </span>
      </div>
      <style>{`@media (max-width: 600px) { .hdr-tag { display: none; } .hdr-left { gap: 10px !important; width: 100%; justify-content: space-between; } }`}</style>
    </header>
  );
}

function Mark() {
  // A seal: the ring is the vendor record, the bar is the letter it must match.
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <circle cx="11" cy="11" r="9.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="6" y="10.1" width="10" height="1.8" rx=".9" fill="currentColor" />
      <circle cx="11" cy="11" r="2.6" fill="var(--hold)" />
    </svg>
  );
}
