import type { Metadata, Viewport } from "next";
import { Newsreader, Hanken_Grotesk, IBM_Plex_Mono } from "next/font/google";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const serif = Newsreader({ subsets: ["latin"], variable: "--ff-serif", display: "swap" });
const sans = Hanken_Grotesk({ subsets: ["latin"], variable: "--ff-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--ff-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Probity · bank-change checks before the payment run",
  description:
    "Probity reads a vendor's bank-change letter, checks the vendor in public registries and on the web, and tells the AP clerk to approve, call back or hold — with a number to call that did not come from the letter. Built on NVIDIA Nemotron, Nebius Token Factory and Nebius AI Cloud.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9f5ef" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0c0b" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <SiteHeader />
        <main>{children}</main>
        <footer className="wrap" style={{ padding: "48px var(--gutter) 40px", color: "var(--muted)", fontSize: 13 }}>
          <div className="between" style={{ flexWrap: "wrap", borderTop: "1px solid var(--rule)", paddingTop: 18 }}>
            <span>
              The buying company, its vendors' records and every letter are synthetic. Registry facts and web results are live.
            </span>
            <span className="row" style={{ gap: 14, fontSize: 13 }}><a href="/pricing">Pricing</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><span className="mono">MIT licence</span></span>
          </div>
        </footer>
      </body>
    </html>
  );
}
