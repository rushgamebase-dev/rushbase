"use client";

import { useReadContract } from "wagmi";
import { FACTORY_ABI, FACTORY_ADDRESS } from "@/lib/contracts";
import { IS_DEMO_MODE } from "@/lib/mock";

/**
 * Finds the currently active market from MarketFactory.
 * Returns the first active market address, or null.
 * Polls every 10 seconds.
 * Falls back to null if FACTORY_ADDRESS is empty (demo mode).
 */
export function useActiveMarket() {
  const enabled = !IS_DEMO_MODE && !!FACTORY_ADDRESS;

  const { data, isLoading, error, refetch } = useReadContract({
    address: FACTORY_ADDRESS || undefined,
    abi: FACTORY_ABI,
    functionName: "getActiveMarkets",
    query: {
      enabled,
      refetchInterval: 10_000,
    },
  });

  const activeMarkets = (data as `0x${string}`[] | undefined) ?? [];
  const marketAddress = activeMarkets.length > 0 ? activeMarkets[0] : null;

  return {
    marketAddress,
    activeMarkets,
    isLoading: enabled ? isLoading : false,
    error,
    refetch,
    isDemoMode: IS_DEMO_MODE,
  };
}
