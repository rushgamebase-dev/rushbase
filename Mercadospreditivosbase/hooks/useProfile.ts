"use client";

import { useQuery } from "@tanstack/react-query";
import type { ProfileData } from "@/lib/api-types";

const DEFAULT_PROFILE: ProfileData = {
  address: "",
  totalBets: 0,
  wins: 0,
  losses: 0,
  winRate: 0,
  totalWagered: 0,
  totalPnl: 0,
  bets: [],
};

export function useProfile(address: string | undefined) {
  const query = useQuery({
    queryKey: ["profile", address],
    queryFn: async () => {
      if (!address) return { profile: DEFAULT_PROFILE };
      const res = await fetch(`/api/profile/${address}`);
      if (!res.ok) return { profile: DEFAULT_PROFILE };
      return res.json() as Promise<{ profile: ProfileData }>;
    },
    enabled: !!address,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  return {
    profile: query.data?.profile ?? DEFAULT_PROFILE,
    isLoading: query.isLoading,
  };
}
