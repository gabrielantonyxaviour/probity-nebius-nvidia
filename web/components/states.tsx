export function Skeleton({ h = 16, w = "100%", r = 6 }: { h?: number; w?: number | string; r?: number }) {
  return <span aria-hidden="true" className="pulse" style={{ display: "block", height: h, width: w, borderRadius: r, background: "var(--surface-2)" }} />;
}

export function ErrorBox({ error, onRetry }: { error: { message: string }; onRetry?: () => void }) {
  return (
    <div role="alert" className="card pad" style={{ borderColor: "var(--hold-border)", background: "var(--hold-bg)" }}>
      <div className="between" style={{ flexWrap: "wrap" }}>
        <span style={{ color: "var(--hold)" }}>{error.message}</span>
        {onRetry && <button className="btn" onClick={onRetry}>Try again</button>}
      </div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="card pad" style={{ textAlign: "center", padding: "36px 20px" }}>
      <p className="serif" style={{ fontSize: 22, margin: "0 0 6px" }}>{title}</p>
      <div className="muted">{children}</div>
    </div>
  );
}
