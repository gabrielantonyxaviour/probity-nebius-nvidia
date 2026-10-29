type Section = { h: string; p: string[] };

export function LegalPage({ title, updated, sections }: { title: string; updated: string; sections: Section[] }) {
  return (
    <article className="wrap" style={{ paddingTop: 34, maxWidth: 760 }}>
      <p className="label" style={{ margin: 0 }}>Probity · last updated {updated}</p>
      <h1 className="serif" style={{ fontSize: "clamp(30px, 4vw, 42px)", margin: "8px 0 22px" }}>{title}</h1>
      <div style={{ display: "grid", gap: 22 }}>
        {sections.map((s) => (
          <section key={s.h}>
            <h2 style={{ fontSize: 17, fontWeight: 600, margin: "0 0 6px" }}>{s.h}</h2>
            {s.p.map((t) => <p key={t} className="muted" style={{ margin: "0 0 8px", fontSize: 15.5, lineHeight: 1.6 }}>{t}</p>)}
          </section>
        ))}
      </div>
    </article>
  );
}
