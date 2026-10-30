"use client";
import { useEffect, useId, useRef, useState } from "react";
import "./ui.css";

export type Option<T extends string | number> = { value: T; label: string; hint?: string };

type Props<T extends string | number> = {
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
  label?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  id?: string;
  width?: number | string;
  disabled?: boolean;
  mono?: boolean;
  placeholder?: string;
};

/** A designed listbox select: button trigger, popover list, check on the chosen option, full keyboard support. */
export function Select<T extends string | number>(p: Props<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const uid = useId();
  const listId = `${uid}-list`;
  const selectedIndex = Math.max(0, p.options.findIndex((o) => o.value === p.value));
  const current = p.options.find((o) => o.value === p.value);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function show() { if (p.disabled) return; setActive(selectedIndex); setOpen(true); }
  function pick(i: number) {
    const o = p.options[i];
    if (o) p.onChange(o.value);
    setOpen(false);
    trigger.current?.focus();
  }
  function typeAhead(key: string) {
    const now = Date.now();
    const t = typed.current;
    t.text = now - t.at > 600 ? key : t.text + key;
    t.at = now;
    const from = open ? active : selectedIndex;
    const n = p.options.length;
    for (let k = 1; k <= n; k++) {
      const i = (from + (t.text.length > 1 ? k - 1 : k)) % n;
      if (p.options[i].label.toLowerCase().startsWith(t.text.toLowerCase())) {
        if (open) setActive(i); else p.onChange(p.options[i].value);
        return;
      }
    }
  }
  function onKey(e: React.KeyboardEvent) {
    const n = p.options.length;
    if (p.disabled || !n) return;
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); if (!open) show(); else setActive((a) => Math.min(n - 1, a + 1)); break;
      case "ArrowUp": e.preventDefault(); if (!open) show(); else setActive((a) => Math.max(0, a - 1)); break;
      case "Home": if (open) { e.preventDefault(); setActive(0); } break;
      case "End": if (open) { e.preventDefault(); setActive(n - 1); } break;
      case "PageDown": if (open) { e.preventDefault(); setActive((a) => Math.min(n - 1, a + 6)); } break;
      case "PageUp": if (open) { e.preventDefault(); setActive((a) => Math.max(0, a - 6)); } break;
      case "Enter": case " ":
        e.preventDefault();
        if (open) pick(active); else show();
        break;
      case "Escape": if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); } break;
      case "Tab": if (open) setOpen(false); break;
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) typeAhead(e.key);
    }
  }

  return (
    <div ref={root} className="ui-select" style={{ width: p.width }} onKeyDown={onKey}>
      <button
        ref={trigger} id={p.id} type="button" className={`ui-control ui-trigger${p.mono ? " mono" : ""}`}
        role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId}
        aria-label={p["aria-label"]} aria-labelledby={p["aria-labelledby"]}
        aria-activedescendant={open ? `${uid}-o${active}` : undefined}
        disabled={p.disabled} onClick={() => (open ? setOpen(false) : show())}
      >
        <span className={current ? "ui-value" : "ui-value ui-placeholder"}>{current?.label ?? p.placeholder ?? "Choose…"}</span>
        <Chevron />
      </button>
      {open && (
        <ul ref={list} id={listId} role="listbox" className="ui-pop" tabIndex={-1} aria-label={p["aria-label"]} aria-labelledby={p["aria-labelledby"]}>
          {p.options.map((o, i) => {
            const sel = o.value === p.value;
            return (
              <li
                key={String(o.value)} id={`${uid}-o${i}`} data-index={i} role="option" aria-selected={sel}
                className={`ui-option${i === active ? " active" : ""}${p.mono ? " mono" : ""}`}
                onPointerMove={() => setActive(i)} onPointerDown={(e) => e.preventDefault()} onClick={() => pick(i)}
              >
                <span className="ui-check" aria-hidden>{sel && <Check />}</span>
                <span className="ui-opt-label">{o.label}</span>
                {o.hint && <span className="ui-opt-hint">{o.hint}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function Chevron() {
  return (
    <svg className="ui-chevron" width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 6.5 8 10l3.5-3.5" />
    </svg>
  );
}

export function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 8.5 6.5 11.5 12.5 5" />
    </svg>
  );
}
