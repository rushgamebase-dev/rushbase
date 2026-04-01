"use client";

import { useState, useEffect, useRef } from "react";
import type { RoundResult } from "@/lib/mock";

const POLL_INTERVAL = 15_000; // 15s

export function useRoundHistory(limit = 10) {
  const [history, setHistory] = useState<RoundResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    async function fetchHistory() {
      try {
        const res = await fetch(`/api/rounds/history?limit=${limit}`);
        if (!res.ok) return;
        const data = await res.json();
        const rounds = (data.rounds || []).map((r: {
          roundNumber: number;
          result: "over" | "under";
          actualCount: number;
          threshold: number;
          totalPool: string;
          resolvedAt: number;
        }) => ({
          roundId: r.roundNumber,
          result: r.result,
          actualCount: r.actualCount,
          threshold: r.threshold,
          pool: parseFloat(r.totalPool) || 0,
          resolvedAt: r.resolvedAt,
        }));
        if (mounted.current) {
          setHistory(rounds);
          setIsLoading(false);
        }
      } catch {
        // silently ignore
      }
    }

    fetchHistory();
    const interval = setInterval(fetchHistory, POLL_INTERVAL);
    return () => {
      mounted.current = false;
      clearInterval(interval);
    };
  }, [limit]);

  return { history, isLoading };
}
