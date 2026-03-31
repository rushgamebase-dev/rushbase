"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/fetcher";
import { apiToDisplay } from "@/lib/api-types";
import type { MarketRecord } from "@/lib/api-types";
import type { MarketCategory, MarketSort, MarketDisplay } from "@/types/market";

interface UseMarketsOptions {
  category?: MarketCategory | "all";
  sort?: MarketSort;
  search?: string;
  status?: string;
  limit?: number;
}

export function useMarkets(options: UseMarketsOptions = {}) {
  const { category = "all", sort = "newest", search = "", status = "all", limit = 50 } = options;

  const query = useQuery({
    queryKey: ["markets", { category, sort, search, status, limit }],
    queryFn: async () => {
      const data = await fetchApi<{ markets: MarketRecord[]; total: number }>("/api/markets", {
        params: {
          status,
          category: category !== "all" ? category : undefined,
          limit,
        },
      });
      return data;
    },
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  // Client-side sort and search (API may not support all filters)
  const markets: MarketDisplay[] = (query.data?.markets ?? [])
    .map(apiToDisplay)
    .filter(m => {
      if (search) {
        const q = search.toLowerCase();
        return m.title.toLowerCase().includes(q);
      }
      return true;
    })
    .sort((a, b) => {
      switch (sort) {
        case "most-volume": return parseFloat(b.volume) - parseFloat(a.volume);
        case "ending-soon": return 0; // API handles this
        default: return 0;
      }
    });

  return {
    markets,
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isMock: false,
    error: query.error,
    refetch: query.refetch,
  };
}
