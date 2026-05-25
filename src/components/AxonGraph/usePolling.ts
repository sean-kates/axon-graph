import { useState, useEffect, useRef, useCallback } from "react";
import type { RawGraph, ResolvedGraph } from "../../types";
import { propagate } from "../../engine";

interface PollingState {
  data: ResolvedGraph | null;
  error: Error | null;
  loading: boolean;
  lastUpdated: Date | null;
}

export function usePolling(
  configUrl: string,
  pollInterval: number
): PollingState {
  const [state, setState] = useState<PollingState>({
    data: null,
    error: null,
    loading: true,
    lastUpdated: null,
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(configUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const raw: RawGraph = await res.json();
      const resolved = propagate(raw);
      if (mountedRef.current) {
        setState({ data: resolved, error: null, loading: false, lastUpdated: new Date() });
      }
    } catch (err) {
      if (mountedRef.current) {
        setState((prev) => ({
          ...prev,
          error: err instanceof Error ? err : new Error(String(err)),
          loading: false,
        }));
      }
    }
  }, [configUrl]);

  useEffect(() => {
    mountedRef.current = true;
    fetchData();

    const schedule = () => {
      timerRef.current = setTimeout(() => {
        fetchData().then(schedule);
      }, pollInterval);
    };
    schedule();

    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [fetchData, pollInterval]);

  return state;
}
