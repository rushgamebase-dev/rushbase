"use client";
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CHANNELS, EVENTS } from "@/lib/ably";

export function useMarketStream() {
  const queryClient = useQueryClient();
  const ablyRef = useRef<any>(null);
  const marketChannelRef = useRef<any>(null);
  const betsChannelRef = useRef<any>(null);

  useEffect(() => {
    let mounted = true;

    async function connect() {
      try {
        const tokenCheck = await fetch("/api/ably-token").then(r => r.json());
        if (tokenCheck.mock) return;

        const Ably = (await import("ably")).default;
        const client = new Ably.Realtime({
          authUrl: "/api/ably-token",
          autoConnect: true,
        });

        if (!mounted) {
          client.close();
          return;
        }

        ablyRef.current = client;

        // ---------------------------------------------------------------
        // Market events channel
        // ---------------------------------------------------------------
        const marketChannel = client.channels.get(CHANNELS.MARKET_EVENTS);
        marketChannelRef.current = marketChannel;

        // New market created -- invalidate full market list
        marketChannel.subscribe(EVENTS.MARKET_CREATED, () => {
          queryClient.invalidateQueries({ queryKey: ["markets"] });
        });

        // Market resolved -- invalidate list + any on-chain reads
        marketChannel.subscribe(EVENTS.MARKET_RESOLVED, () => {
          queryClient.invalidateQueries({ queryKey: ["markets"] });
          queryClient.invalidateQueries({ queryKey: ["readContract"] });
        });

        // Market cancelled
        marketChannel.subscribe(EVENTS.MARKET_CANCELLED, () => {
          queryClient.invalidateQueries({ queryKey: ["markets"] });
        });

        // Odds changed -- invalidate contract reads + odds queries
        marketChannel.subscribe(EVENTS.ODDS_UPDATED, () => {
          queryClient.invalidateQueries({ queryKey: ["readContract"] });
        });

        // ---------------------------------------------------------------
        // Bets channel
        // ---------------------------------------------------------------
        const betsChannel = client.channels.get(CHANNELS.BETS);
        betsChannelRef.current = betsChannel;

        betsChannel.subscribe(EVENTS.BET_PLACED, (msg: any) => {
          queryClient.invalidateQueries({ queryKey: ["activity"] });
          queryClient.invalidateQueries({ queryKey: ["stats"] });

          // If the message contains a marketAddress, also invalidate that
          // market's specific queries for fresh data
          const addr = msg.data?.marketAddress;
          if (addr) {
            queryClient.invalidateQueries({ queryKey: ["market", addr] });
            queryClient.invalidateQueries({ queryKey: ["odds", addr] });
          }
        });
      } catch (err) {
        // Ably not configured -- graceful fallback, polling handles updates
        console.debug("Ably not connected (expected in mock mode):", err);
      }
    }

    connect();

    return () => {
      mounted = false;
      try { marketChannelRef.current?.unsubscribe(); } catch {}
      try { betsChannelRef.current?.unsubscribe(); } catch {}
      try { ablyRef.current?.close(); } catch {}
    };
  }, [queryClient]);
}
