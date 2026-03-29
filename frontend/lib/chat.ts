"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import * as Ably from "ably";

export interface ChatMessage {
  id: string;
  username: string;
  address: string;
  color: string;
  text: string;
  timestamp: number;
}

const CHANNEL_NAME = "rush:chat";
const MAX_MESSAGES = 200;

function usernameFromAddress(address?: string): string {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "anon";
}

function colorFromAddress(address?: string): string {
  let hash = 0;
  const seed = address || "anon";
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return `hsl(${Math.abs(hash % 360)}, 70%, 60%)`;
}

export type ChatStatus = "connecting" | "connected" | "disconnected";

/**
 * Real-time chat via Ably WebSocket.
 * Exposes connection status for UI feedback.
 */
export function useChat(walletAddress?: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("connecting");
  const ablyRef = useRef<Ably.Realtime | null>(null);
  const channelRef = useRef<Ably.RealtimeChannel | null>(null);
  const mountedRef = useRef(true);
  // Keep address in a ref so the Ably connection never re-creates on wallet change
  const walletRef = useRef(walletAddress);
  walletRef.current = walletAddress;

  useEffect(() => {
    mountedRef.current = true;
    setStatus("connecting");

    async function init() {
      try {
        const ably = new Ably.Realtime({
          authUrl: "/api/ably-token",
          autoConnect: true,
        });
        ablyRef.current = ably;

        // Connection state tracking
        ably.connection.on("connected", () => {
          if (mountedRef.current) setStatus("connected");
        });
        ably.connection.on("disconnected", () => {
          if (mountedRef.current) setStatus("disconnected");
        });
        ably.connection.on("suspended", () => {
          if (mountedRef.current) setStatus("disconnected");
        });
        ably.connection.on("closed", () => {
          if (mountedRef.current) setStatus("disconnected");
        });
        ably.connection.on("failed", () => {
          if (mountedRef.current) setStatus("disconnected");
        });

        const channel = ably.channels.get(CHANNEL_NAME);
        channelRef.current = channel;

        // Subscribe to messages
        channel.subscribe("message", (msg: Ably.Message) => {
          if (!mountedRef.current) return;
          const data = msg.data as ChatMessage;
          if (data?.id && data?.text) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === data.id)) return prev;
              return [...prev, data].slice(-MAX_MESSAGES);
            });
          }
        });

        // Load history
        try {
          const history = await channel.history({ limit: 50, direction: "forwards" });
          if (mountedRef.current && history.items.length > 0) {
            const hist = history.items
              .filter((item: Ably.Message) => item.name === "message" && (item.data as ChatMessage)?.id)
              .map((item: Ably.Message) => item.data as ChatMessage);
            setMessages(hist.slice(-MAX_MESSAGES));
          }
        } catch { /* history might fail */ }
      } catch {
        if (mountedRef.current) setStatus("disconnected");
      }
    }

    init();

    return () => {
      mountedRef.current = false;
      try { channelRef.current?.unsubscribe(); } catch {}
      // close() returns a Promise at runtime despite void TS type — catch the rejection
      if (ablyRef.current) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Promise.resolve((ablyRef.current as any).close()).catch(() => {});
      }
      ablyRef.current = null;
      channelRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !channelRef.current) return;

      const addr = walletRef.current;
      const msg: ChatMessage = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        username: usernameFromAddress(addr),
        address: addr || "",
        color: colorFromAddress(addr),
        text: trimmed.slice(0, 200),
        timestamp: Date.now(),
      };

      channelRef.current.publish("message", msg);
    },
    [],
  );

  return { messages, status, sendMessage };
}
