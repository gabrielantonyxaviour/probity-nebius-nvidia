import { LandingFooter, LandingHeader, Reveal } from "@/components/landing/chrome";
import "@/components/landing/landing.css";

/** Public pages (landing, pricing, how it works, sign-in, legal): the dark sheet with the marketing header and footer. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="lp">
      <style>{"html, body { background: #0c0c0b; }"}</style>
      <LandingHeader />
      <main>{children}</main>
      <LandingFooter />
      <Reveal />
    </div>
  );
}
