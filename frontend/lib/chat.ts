"use client";

import { useState, useCallback, useEffect, useRef } from "react";

export interface ChatMessage {
  id: string;
  username: string;
  address: string;
  color: string;
  text: string;
  timestamp: number;
}

const POLL_INTERVAL = 3000;      // 3s message polling
const HEARTBEAT_INTERVAL = 15000; // 15s heartbeat

/**
 * Global chat hook backed by /api/chat/* endpoints.
 * Falls back to localStorage-only if API is unreachable.
 */
export function useChat(walletAddress?: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [onlineCount, setOnlineCount] = useState(0);
  const lastTimestamp = useRef(0);
  const isMounted = useRef(true);

  // Poll for new messages
  useEffect(() => {
    isMounted.current = true;

    async function fetchMessages() {
      try {
        const url = lastTimestamp.current > 0
          ? `/api/chat/messages?after=${lastTimestamp.current}&limit=50`
          : `/api/chat/messages?limit=100`;

        const res = await fetch(url);
        if (!res.ok) return;

        const data = await res.json();
        const newMsgs: ChatMessage[] = data.messages || [];

        if (newMsgs.length > 0 && isMounted.current) {
          setMessages((prev) => {
            const existingIds = new Set(prev.map((m) => m.id));
            const unique = newMsgs.filter((m) => !existingIds.has(m.id));
            if (unique.length === 0) return prev;
            const merged = [...prev, ...unique].slice(-200);
            return merged;
          });

          const maxTs = Math.max(...newMsgs.map((m) => m.timestamp));
          if (maxTs > lastTimestamp.current) {
            lastTimestamp.current = maxTs;
          }
        }
      } catch {
        // API unreachable — silently ignore
      }
    }

    fetchMessages();
    const interval = setInterval(fetchMessages, POLL_INTERVAL);
    return () => {
      isMounted.current = false;
      clearInterval(interval);
    };
  }, []);

  // Heartbeat for online count
  useEffect(() => {
    async function heartbeat() {
      try {
        const addr = walletAddress || "";
        const url = addr ? `/api/chat/online?heartbeat=${addr}` : "/api/chat/online";
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        if (isMounted.current) {
          setOnlineCount(data.online ?? 0);
        }
      } catch {
        // silently ignore
      }
    }

    heartbeat();
    const interval = setInterval(heartbeat, HEARTBEAT_INTERVAL);
    return () => clearInterval(interval);
  }, [walletAddress]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      // Optimistic local insert
      const username = walletAddress
        ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
        : "anon";
      let hash = 0;
      const seed = walletAddress || "anon";
      for (let i = 0; i < seed.length; i++) {
        hash = seed.charCodeAt(i) + ((hash << 5) - hash);
      }
      const hue = Math.abs(hash % 360);
      const color = `hsl(${hue}, 70%, 60%)`;

      const optimistic: ChatMessage = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        username,
        address: walletAddress || "",
        color,
        text: trimmed,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, optimistic].slice(-200));

      try {
        await fetch("/api/chat/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: trimmed, address: walletAddress || "" }),
        });
      } catch {
        // Message stays local if API fails
      }
    },
    [walletAddress],
  );

  return { messages, onlineCount, sendMessage };
}
