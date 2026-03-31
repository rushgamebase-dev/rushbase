"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef, useCallback } from "react";
import { fetchApi } from "@/lib/fetcher";
import { CHANNELS, EVENTS } from "@/lib/ably";
import type { OddsSnapshot } from "@/lib/api-types";
import type { Outcome } from "@/types/market";

export function useMarketOdds(marketAddress: string | null, initialOutcomes: Outcome[]) {
  const queryClient = useQueryClient();
  const prevOddsRef = useRef<Record<string, number>>({});
  const [flashingIds, setFlashingIds] = useState<Set<string>>(new Set());

  // Fetch odds from API
  const query = useQuery({
    queryKey: ["odds", marketAddress],
    queryFn: async () => {
      if (!marketAddress) return null;
      const data = await fetchApi<{ odds: OddsSnapshot }>(`/api/markets/${marketAddress}/odds`);
      return data.odds;
    },
    enabled: !!marketAddress,
    staleTime: 3_000,
    refetchInterval: 15_000,
    // If no API data yet, seed with initialOutcomes
    placeholderData: {
      marketAddress: marketAddress || "",
      outcomes: initialOutcomes.map(o => ({
        id: o.id,
        label: o.label,
        pool: String(o.pool),
        probability: o.probability,
        odds: o.odds,
      })),
      totalPool: String(initialOutcomes.reduce((sum, o) => sum + o.pool, BigInt(0))),
      timestamp: Date.now(),
    } as OddsSnapshot,
  });

  // Convert API odds to Outcome[] format
  const outcomes: Outcome[] = (query.data?.outcomes ?? []).map(o => ({
    id: o.id,
    label: o.label,
    probability: o.probability,
    odds: o.odds,
    pool: BigInt(o.pool || "0"),
  }));

  // Flash detection: compare with previous odds
  useEffect(() => {
    const newFlashing = new Set<string>();
    outcomes.forEach(o => {
      const prev = prevOddsRef.current[o.id];
      if (prev !== undefined && prev !== o.odds) {
        newFlashing.add(o.id);
      }
    });
    if (newFlashing.size > 0) {
      setFlashingIds(newFlashing);
      const timer = setTimeout(() => setFlashingIds(new Set()), 700);
      return () => clearTimeout(timer);
    }
    // Update ref
    const next: Record<string, number> = {};
    outcomes.forEach(o => { next[o.id] = o.odds; });
    prevOddsRef.current = next;
  }, [outcomes]);

  // Ably real-time listener for instant odds updates
  useEffect(() => {
    if (!marketAddress) return;
    let channel: any = null;
    let client: any = null;

    async function subscribe() {
      try {
        // Check if Ably is configured (skip in mock mode)
        const tokenCheck = await fetch("/api/ably-token").then(r => r.json());
        if (tokenCheck.mock) return;

        const Ably = (await import("ably")).default;
        client = new Ably.Realtime({ authUrl: "/api/ably-token" });
        channel = client.channels.get(CHANNELS.MARKET_EVENTS);

        channel.subscribe(EVENTS.ODDS_UPDATED, (msg: any) => {
          if (msg.data?.marketAddress === marketAddress) {
            queryClient.setQueryData(["odds", marketAddress], msg.data);
          }
        });
      } catch {
        // Ably not available -- polling handles updates
      }
    }

    subscribe();
    return () => {
      try { channel?.unsubscribe(); } catch {}
      try { client?.close(); } catch {}
    };
  }, [marketAddress, queryClient]);

  // Optimistic update when user places a bet locally
  const optimisticBet = useCallback(
    (outcomeId: string, amountWei: bigint) => {
      queryClient.setQueryData(["odds", marketAddress], (old: OddsSnapshot | undefined) => {
        if (!old) return old;
        const newTotalPool = BigInt(old.totalPool) + amountWei;
        const newOutcomes = old.outcomes.map(o => {
          const newPool = o.id === outcomeId ? BigInt(o.pool) + amountWei : BigInt(o.pool);
          return {
            ...o,
            pool: String(newPool),
            odds: Math.round((Number(newTotalPool) / Number(newPool)) * 100) / 100,
            probability: Math.round((Number(newPool) / Number(newTotalPool)) * 100),
          };
        });
        return { ...old, outcomes: newOutcomes, totalPool: String(newTotalPool), timestamp: Date.now() };
      });
    },
    [marketAddress, queryClient]
  );

  return {
    outcomes,
    totalPool: BigInt(query.data?.totalPool || "0"),
    lastUpdate: query.data?.timestamp ?? Date.now(),
    flashingIds,
    optimisticBet,
  };
}
