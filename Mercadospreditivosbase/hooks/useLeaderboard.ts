"use client";

import { useQuery } from "@tanstack/react-query";
import type { LeaderboardEntry } from "@/lib/api-types";

export function useLeaderboard(limit: number = 20) {
  const query = useQuery({
    queryKey: ["leaderboard", limit],
    queryFn: async () => {
      const res = await fetch(`/api/stats/leaderboard?limit=${limit}`);
      if (!res.ok) return { leaderboard: [] };
      return res.json() as Promise<{ leaderboard: LeaderboardEntry[] }>;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  return {
    leaderboard: query.data?.leaderboard ?? [],
    isLoading: query.isLoading,
  };
}
