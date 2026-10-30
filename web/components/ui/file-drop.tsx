"use client";
import { useId, useRef, useState } from "react";
import "./file-drop.css";

type Props = {
  label: string;
  /** Value for the hidden input's accept attribute. */
  accept: string;
  /** File-name pattern a dropped file must match, e.g. /\.pdf$/i. */
  pattern: RegExp;
  /** Short human list of accepted types, e.g. "PDF". */
  typeLabel: string;
  maxBytes: number;
  file: File | null;
  onFile: (file: File | null) => void;
  prompt: string;
  hint?: string;
  optional?: boolean;
  compact?: boolean;
  disabled?: boolean;
};

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${+(n / 1024 / 1024).toFixed(1)} MB`;
}

export function FileDrop(p: Props) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function take(list: FileList | null | undefined) {
    const f = list?.[0];
    if (!f) return;
    if (!p.pattern.test(f.name)) return setError(`That file is not a ${p.typeLabel}. Choose a ${p.typeLabel} file.`);
    if (f.size > p.maxBytes) return setError(`That file is ${formatBytes(f.size)}. The limit is ${formatBytes(p.maxBytes)}.`);
    if (f.size === 0) return setError("That file is empty.");
    setError(null);
    p.onFile(f);
  }

  function open() {
    if (!p.disabled) input.current?.click();
  }

  function clear() {
    p.onFile(null);
    setError(null);
    if (input.current) input.current.value = "";
  }

  const cls = ["fd", p.compact ? "fd-compact" : "", over ? "is-over" : "", error ? "is-error" : "", p.file ? "has-file" : ""]
    .filter(Boolean).join(" ");

  return (
    <div className={cls}>
      <div className="fd-head">
        <span className="fd-label" id={`${id}-l`}>{p.label}</span>
        {p.optional && <span className="fd-opt">Optional</span>}
      </div>
      <input ref={input} id={id} type="file" accept={p.accept} className="sr" tabIndex={-1} aria-hidden
        onChange={(e) => take(e.target.files)} />
      {p.file ? (
        <div className="fd-file">
          <FileGlyph ext={p.typeLabel} />
          <div className="fd-meta">
            <span className="fd-name" title={p.file.name}>{p.file.name}</span>
            <span className="fd-size mono">{formatBytes(p.file.size)} · ready</span>
          </div>
          <button type="button" className="fd-x" onClick={clear} disabled={p.disabled} aria-label={`Remove ${p.file.name}`}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={p.disabled ? -1 : 0}
          aria-labelledby={`${id}-l`}
          aria-describedby={`${id}-d`}
          aria-disabled={p.disabled}
          className="fd-zone"
          onClick={open}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }}
          onDragEnter={(e) => { e.preventDefault(); setOver(true); }}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
          onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}
        >
          <span className="fd-icon" aria-hidden>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" /><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
            </svg>
          </span>
          <span className="fd-text">
            <span className="fd-prompt">{over ? "Release to add it" : <>{p.prompt} or <u>browse</u></>}</span>
            <span className="fd-rule mono" id={`${id}-d`}>{p.typeLabel} · up to {formatBytes(p.maxBytes)}</span>
          </span>
        </div>
      )}
      {error ? <p className="fd-err" role="alert">{error}</p> : p.hint ? <p className="fd-hint">{p.hint}</p> : null}
    </div>
  );
}

function FileGlyph({ ext }: { ext: string }) {
  return (
    <span className="fd-glyph" aria-hidden>
      <svg viewBox="0 0 32 40" width="28" height="35" fill="none">
        <path d="M4 2h17l9 9v25a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" fill="var(--surface)" stroke="var(--rule-strong)" strokeWidth="1.5" />
        <path d="M21 2v7a2 2 0 0 0 2 2h7" stroke="var(--rule-strong)" strokeWidth="1.5" />
      </svg>
      <span className="fd-ext mono">{ext.replace(/^\./, "").slice(0, 3).toUpperCase()}</span>
    </span>
  );
}
