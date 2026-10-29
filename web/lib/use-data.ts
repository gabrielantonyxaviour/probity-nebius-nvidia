"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiFailure } from "./api";

export type Loadable<T> = { data: T | null; error: ApiFailure | null; loading: boolean; reload: () => void };

/** Load once, and again every `pollMs` while `keepPolling(data)` says so. */
export function useData<T>(load: () => Promise<T>, deps: unknown[], pollMs = 0, keepPolling?: (d: T) => boolean): Loadable<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      try {
        const d = await loadRef.current();
        if (!alive) return;
        setData(d);
        setError(null);
        if (pollMs && (!keepPolling || keepPolling(d))) timer = setTimeout(run, pollMs);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof ApiFailure ? e : new ApiFailure("Something went wrong.", undefined, 0));
        if (pollMs) timer = setTimeout(run, pollMs * 2);
      } finally {
        if (alive) setLoading(false);
      }
    };
    run();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, pollMs]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}
