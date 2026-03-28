"use client";

import { useState, useEffect, useRef } from "react";
import type { PlatformStats } from "@/lib/ledger";

const POLL_INTERVAL = 30_000; // 30s

const EMPTY_STATS: PlatformStats = {
  totalVolume: 0,
  marketsResolved: 0,
  uniqueBettors: 0,
  feesDistributed: 0,
  avgPoolSize: 0,
  biggestRound: 0,
  avgBettorsPerRound: 0,
  volume24h: 0,
};

export function useStats() {
  const [stats, setStats] = useState<PlatformStats>(EMPTY_STATS);
  const [isLoading, setIsLoading] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    async function fetchStats() {
      try {
        const res = await fetch("/api/stats");
        if (!res.ok) return;
        const data = await res.json();
        if (mounted.current) {
          setStats(data);
          setIsLoading(false);
        }
      } catch {
        // silently ignore
      }
    }

    fetchStats();
    const interval = setInterval(fetchStats, POLL_INTERVAL);
    return () => {
      mounted.current = false;
      clearInterval(interval);
    };
  }, []);

  return { stats, isLoading };
}
