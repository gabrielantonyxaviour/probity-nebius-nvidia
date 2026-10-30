/* eslint-disable @next/next/no-img-element */
// Real brand marks (official files in /public/brands). On the logo wall they sit in white and take their own colour on hover.
type Brand = { name: string; role: string; logo?: string; wordmark?: boolean; mark?: string };

export const WALL: Brand[] = [
  { name: "Gmail", role: "Mailbox", logo: "/brands/gmail.svg" },
  { name: "Outlook", role: "Mailbox", logo: "/brands/outlook.svg" },
  { name: "Xero", role: "Accounting", logo: "/brands/xero.svg" },
  { name: "Slack", role: "Team", logo: "/brands/slack.svg" },
  { name: "Dodo Payments", role: "Billing", logo: "/brands/dodo.svg", wordmark: true },
  { name: "SEC EDGAR", role: "Registry", mark: "SEC" },
  { name: "NVIDIA Nemotron", role: "Models", logo: "/brands/nvidia.svg" },
  { name: "Nebius", role: "Inference", logo: "/brands/nebius.svg", wordmark: true },
  { name: "NeMo Guardrails", role: "Guardrails", logo: "/brands/nvidia.svg" },
  { name: "Tavily", role: "Web search", logo: "/brands/tavily.svg", wordmark: true },
  { name: "GLEIF", role: "Registry", logo: "/brands/gleif.svg" },
  { name: "USAspending", role: "Registry", mark: "USA" },
];

export function LogoWall() {
  return (
    <section className="lp-sec" style={{ paddingBottom: 0 }}>
      <div className="lp-frame">
        <div className="lp-wall-head lp-rv">
          <div>
            <p className="lp-eyebrow lp-mono">Integrations</p>
            <h2 className="lp-h2">Works where your AP team already works.</h2>
          </div>
          <p className="lp-body" style={{ margin: 0 }}>Your mailbox, your accounting system and your team chat on one side; NVIDIA models on Nebius, public registries and the open web on the other.</p>
        </div>
        <div className="lp-wall lp-rv">
          {WALL.map((b) => (
            <div key={b.name} className="lp-brandcell">
              <div className="lp-brandlogo">
                {b.logo ? <img src={b.logo} alt="" className={b.wordmark ? "wm" : "mk"} /> : <span className="lp-glyph">{b.mark}</span>}
                {!b.wordmark && <span>{b.name}</span>}
              </div>
              <span className="lp-mono lp-role">{b.role}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** A brand tile for the product section: the real mark on a white app-icon square. */
export function BrandTile({ src, alt, color }: { src: string; alt: string; color?: string }) {
  return (
    <span className="lp-tile" title={alt}>
      <img src={src} alt={alt} style={color ? { filter: color } : undefined} />
    </span>
  );
}
