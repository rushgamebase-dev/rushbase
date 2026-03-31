"use client";

import { useQuery } from "@tanstack/react-query";
import type { PlatformStats } from "@/lib/api-types";

const DEFAULT_STATS: PlatformStats = {
  totalVolume: 0,
  totalMarkets: 0,
  marketsResolved: 0,
  marketsOpen: 0,
  uniqueBettors: 0,
  feesDistributed: 0,
  avgPoolSize: 0,
  biggestMarket: 0,
  volume24h: 0,
  bets24h: 0,
};

export function useStats() {
  const query = useQuery({
    queryKey: ["stats"],
    queryFn: async () => {
      const res = await fetch("/api/stats");
      if (!res.ok) return { stats: DEFAULT_STATS };
      return res.json() as Promise<{ stats: PlatformStats }>;
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  return {
    stats: query.data?.stats ?? DEFAULT_STATS,
    isLoading: query.isLoading,
  };
}
