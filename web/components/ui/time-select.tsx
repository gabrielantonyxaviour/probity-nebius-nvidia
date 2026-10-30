"use client";
import { useMemo } from "react";
import { Select, type Option } from "./select";

function label(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** A time picker as a designed select of HH:MM values in fixed steps; keeps an off-step value selectable. */
export function TimeSelect({ value, onChange, step = 30, width = 140, ...rest }: {
  value: string; onChange: (v: string) => void; step?: 15 | 30 | 60; width?: number | string;
  "aria-label"?: string; "aria-labelledby"?: string; disabled?: boolean;
}) {
  const options = useMemo(() => {
    const out: Option<string>[] = [];
    for (let t = 0; t < 24 * 60; t += step) {
      const v = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
      out.push({ value: v, label: label(v) });
    }
    if (/^\d{2}:\d{2}$/.test(value) && !out.some((o) => o.value === value)) {
      out.push({ value, label: label(value) });
      out.sort((a, b) => a.value.localeCompare(b.value));
    }
    return out;
  }, [step, value]);
  return <Select value={value} options={options} onChange={onChange} width={width} {...rest} />;
}
