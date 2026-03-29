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

  useEffect(() => {
    mountedRef.current = true;
    setStatus("connecting");

    async function init() {
      try {
        const addr = walletAddress || "";
        const tokenUrl = addr
          ? `/api/ably-token?address=${addr}`
          : "/api/ably-token";

        const ably = new Ably.Realtime({
          authUrl: tokenUrl,
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
      try { ablyRef.current?.close(); } catch {}
      ablyRef.current = null;
      channelRef.current = null;
    };
  }, [walletAddress]);

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !channelRef.current) return;

      const msg: ChatMessage = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        username: usernameFromAddress(walletAddress),
        address: walletAddress || "",
        color: colorFromAddress(walletAddress),
        text: trimmed.slice(0, 200),
        timestamp: Date.now(),
      };

      channelRef.current.publish("message", msg);
    },
    [walletAddress],
  );

  return { messages, status, sendMessage };
}
