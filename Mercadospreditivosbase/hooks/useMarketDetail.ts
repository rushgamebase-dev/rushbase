"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/fetcher";
import { apiToMarket } from "@/lib/api-types";
import type { MarketRecord, BetRecord } from "@/lib/api-types";
import type { Market } from "@/types/market";

export function useMarketDetail(marketId: string) {
  const query = useQuery({
    queryKey: ["market", marketId],
    queryFn: async () => {
      const data = await fetchApi<{ market: MarketRecord; bets: BetRecord[] }>(
        `/api/markets/${marketId}`
      );
      return {
        market: apiToMarket(data.market),
        bets: data.bets ?? [],
      };
    },
    enabled: !!marketId,
    staleTime: 5_000,
    refetchInterval: 15_000,
  });

  return {
    market: query.data?.market ?? null,
    bets: query.data?.bets ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}
