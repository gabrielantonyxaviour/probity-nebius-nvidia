"use client";
import { forwardRef, useId, useRef, useState } from "react";
import "./ui.css";

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean; invalid?: boolean };

/** Text input at the shared 40px control height. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ mono, invalid, className, ...rest }, ref) {
  return <input ref={ref} className={`ui-control ui-input${mono ? " mono" : ""}${className ? ` ${className}` : ""}`} aria-invalid={invalid || undefined} {...rest} />;
});

type AreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean };

export const Textarea = forwardRef<HTMLTextAreaElement, AreaProps>(function Textarea({ mono, className, ...rest }, ref) {
  return <textarea ref={ref} className={`ui-control ui-textarea${mono ? " mono" : ""}${className ? ` ${className}` : ""}`} {...rest} />;
});

/** Search input with a leading magnifier. */
export function SearchInput(props: Omit<InputProps, "type">) {
  return (
    <div className="ui-search" style={props.style}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg>
      <Input {...props} style={undefined} type="search" />
    </div>
  );
}

/** Label above, control, hint or error below. */
export function FormField({ label, hint, error, htmlFor, children, style }: {
  label: React.ReactNode; hint?: React.ReactNode; error?: string; htmlFor?: string; children: React.ReactNode; style?: React.CSSProperties;
}) {
  return (
    <div className="ui-field" style={style}>
      <label className="ui-field-label" htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <span className="ui-field-error" role="alert">{error}</span> : hint ? <span className="ui-field-hint">{hint}</span> : null}
    </div>
  );
}

/** A file picker: dashed drop zone with a designed button, accepts drag and drop. */
export function FileDrop({ accept, onFile, fileName, prompt = "Choose a file", detail }: {
  accept: string; onFile: (f: File) => void; fileName?: string | null; prompt?: string; detail?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const id = useId();
  return (
    <div
      className={`ui-drop${over ? " over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
    >
      <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13V3.5M6 7.5l4-4 4 4M3.5 13v2.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V13" /></svg>
      <div className="ui-drop-text">
        <span className="ui-drop-title">{fileName ? <span className="mono">{fileName}</span> : prompt}</span>
        {detail && <span className="ui-field-hint">{detail}</span>}
      </div>
      <button type="button" className="btn ui-drop-btn" onClick={() => input.current?.click()}>{fileName ? "Replace" : "Browse"}</button>
      <input id={id} ref={input} type="file" accept={accept} className="sr" tabIndex={-1} aria-hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
    </div>
  );
}
