"use client";

import { useEffect, useState } from "react";

export interface Poll<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

/** Fetch now and then every intervalMs. `fn` must be a stable reference (module-level or useCallback). */
export function usePoll<T>(fn: () => Promise<T>, intervalMs: number): Poll<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const data = await fn();
        if (alive) setState({ data, error: null, loading: false });
      } catch (e) {
        if (alive) setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e), loading: false }));
      }
    };
    void run();
    const id = setInterval(() => void run(), intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [fn, intervalMs, tick]);

  return { ...state, refresh: () => setTick((t) => t + 1) };
}
