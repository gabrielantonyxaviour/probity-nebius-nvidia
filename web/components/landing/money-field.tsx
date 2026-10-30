"use client";
import { useEffect, useRef } from "react";

// The hero's field: a river of "$" glyphs flowing to the payment run. One branch peels off toward a new account and is
// stopped at a gate, drawn in the hold colour. Canvas 2D, one ambient loop, paused off-screen and for reduced motion.
const CELL_W = 11, CELL_H = 15;
const STONE = "#8f8b83", BRIGHT = "#ebe8e2", FAINT = "#3f3d39", HOLD = "#f0727c";

const hash = (x: number, y: number, t: number): number => {
  let h = (x * 374761393 + y * 668265263 + t * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

export function MoneyField() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, visible = true, w = 0, h = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = () => {
      const r = canvas.getBoundingClientRect();
      w = r.width; h = r.height;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `500 12px ${getComputedStyle(document.documentElement).getPropertyValue("--ff-mono") || "monospace"}, ui-monospace, monospace`;
      ctx.textBaseline = "top";
    };
    const draw = (ms: number) => {
      const t = ms / 1000;
      ctx.clearRect(0, 0, w, h);
      const cols = Math.ceil(w / CELL_W), rows = Math.ceil(h / CELL_H);
      const split = 0.56 * cols, gate = 0.8 * cols;
      for (let cx = 0; cx < cols; cx++) {
        const xr = cx / cols;
        const centre = rows * (0.46 + 0.16 * Math.sin(xr * 5.2 + t * 0.35) + 0.05 * Math.sin(xr * 13 - t * 0.6));
        const width = rows * (0.2 + 0.06 * Math.sin(xr * 3 + t * 0.2));
        const branchY = cx > split ? Math.min(rows - 3, centre + (cx - split) * 0.26 + 1) : -999;
        const flow = Math.floor(t * 9 - cx * 0.9);
        for (let cy = 0; cy < rows; cy++) {
          const d = Math.abs(cy - centre) / width;
          const inBranch = cx > split && cx <= gate && Math.abs(cy - branchY) < 1.6;
          const atGate = cx > split && ((Math.abs(cx - gate) < 0.6 && Math.abs(cy - branchY) < 4) || (cx > gate && cx < gate + 2 && Math.abs(cy - branchY) < 1.6));
          const r = hash(cx, cy, flow);
          let ch = "", color = FAINT;
          if (atGate) { ch = Math.abs(cx - gate) < 0.6 ? "|" : "✕"; color = HOLD; }
          else if (inBranch) { ch = r < 0.7 ? "$" : "/"; color = cx > gate - 6 ? HOLD : STONE; }
          else if (d < 1) {
            const p = 1 - d;
            if (r < p * 0.75) { ch = "$"; color = p > 0.62 ? BRIGHT : STONE; }
            else if (r < p * 0.95) { ch = "/"; color = STONE; }
            else if (r < 0.98) ch = ".";
          } else if (r > 0.985) ch = ".";
          if (ch) { ctx.fillStyle = color; ctx.fillText(ch, cx * CELL_W, cy * CELL_H); }
        }
      }
    };
    const loop = (ms: number) => { if (visible) draw(ms); raf = requestAnimationFrame(loop); };
    size();
    if (reduce) draw(4000); else raf = requestAnimationFrame(loop);
    const ro = new ResizeObserver(() => { size(); if (reduce) draw(4000); });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; });
    io.observe(canvas);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
  }, []);
  return <canvas ref={ref} aria-hidden="true" />;
}
