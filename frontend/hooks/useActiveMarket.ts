"use client";

import { useReadContract } from "wagmi";
import { FACTORY_ABI, FACTORY_ADDRESS } from "@/lib/contracts";

/**
 * Finds the currently active market from MarketFactory.
 * Polls every 15s. Ably useMarketStream handles instant detection.
 */
export function useActiveMarket() {
  const enabled = !!FACTORY_ADDRESS;

  const { data, isLoading, error, refetch } = useReadContract({
    address: FACTORY_ADDRESS || undefined,
    abi: FACTORY_ABI,
    functionName: "getActiveMarkets",
    query: {
      enabled,
      refetchInterval: 15_000,
    },
  });

  const { data: marketCountData } = useReadContract({
    address: FACTORY_ADDRESS || undefined,
    abi: FACTORY_ABI,
    functionName: "getMarketCount",
    query: {
      enabled,
      refetchInterval: 30_000,
    },
  });

  const activeMarkets = (data as `0x${string}`[] | undefined) ?? [];
  const marketAddress = activeMarkets.length > 0 ? activeMarkets[0] : null;

  const isWaiting = !isLoading && activeMarkets.length === 0;

  const marketCount = marketCountData !== undefined ? Number(marketCountData as bigint) : 0;

  return {
    marketAddress,
    activeMarkets,
    isLoading: enabled ? isLoading : false,
    error,
    refetch,
    isDemoMode: false,
    isWaiting,
    marketCount,
  };
}
