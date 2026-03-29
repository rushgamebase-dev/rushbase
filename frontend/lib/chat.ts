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

/**
 * Real-time chat via Ably WebSocket.
 * Messages are instant (<100ms) between all connected clients.
 */
export function useChat(walletAddress?: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [onlineCount, setOnlineCount] = useState(0);
  const ablyRef = useRef<Ably.Realtime | null>(null);
  const channelRef = useRef<Ably.RealtimeChannel | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

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

        // Presence — track online count
        const updatePresence = async () => {
          try {
            const members = await channel.presence.get();
            if (mountedRef.current) setOnlineCount(members.length);
          } catch { /* ignore */ }
        };

        channel.presence.subscribe("enter", updatePresence);
        channel.presence.subscribe("leave", updatePresence);

        // Enter presence
        await channel.presence.enter({
          address: walletAddress || "",
          username: usernameFromAddress(walletAddress),
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
        } catch { /* history might fail on free tier */ }

        await updatePresence();
      } catch (err) {
        console.error("Ably init error:", err);
      }
    }

    init();

    return () => {
      mountedRef.current = false;
      try { channelRef.current?.presence.leave().catch(() => {}); } catch {}
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

  return { messages, onlineCount, sendMessage };
}
