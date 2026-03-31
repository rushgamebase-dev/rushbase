"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { CHANNELS, EVENTS } from "@/lib/ably";
import type { BetRecord } from "@/lib/api-types";

export function useActivity(limit: number = 20) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["activity", limit],
    queryFn: async () => {
      const res = await fetch(`/api/activity?limit=${limit}`);
      if (!res.ok) return { activity: [] };
      return res.json() as Promise<{ activity: BetRecord[] }>;
    },
    staleTime: 5_000,
    refetchInterval: 10_000,
  });

  // Ably real-time: prepend new bets instantly
  useEffect(() => {
    let channel: any = null;
    let client: any = null;

    async function subscribe() {
      try {
        const tokenCheck = await fetch("/api/ably-token").then(r => r.json());
        if (tokenCheck.mock) return;

        const Ably = (await import("ably")).default;
        client = new Ably.Realtime({ authUrl: "/api/ably-token" });
        channel = client.channels.get(CHANNELS.BETS);

        channel.subscribe(EVENTS.BET_PLACED, (msg: any) => {
          const newBet = msg.data as BetRecord;
          queryClient.setQueryData(["activity", limit], (old: { activity: BetRecord[] } | undefined) => {
            if (!old) return { activity: [newBet] };
            return { activity: [newBet, ...old.activity].slice(0, 50) };
          });
        });
      } catch {
        // Ably not available, polling handles it
      }
    }

    subscribe();
    return () => {
      try { channel?.unsubscribe(); } catch {}
      try { client?.close(); } catch {}
    };
  }, [queryClient, limit]);

  return {
    activity: query.data?.activity ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}
