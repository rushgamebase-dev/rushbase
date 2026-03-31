"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { CHANNELS } from "@/lib/ably";

interface ChatMessage {
  id: string;
  text: string;
  address: string;
  color: string;
  timestamp: number;
}

export function useChat() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["chat"],
    queryFn: async () => {
      const res = await fetch("/api/chat/messages?limit=50");
      if (!res.ok) return { messages: [] };
      return res.json() as Promise<{ messages: ChatMessage[] }>;
    },
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const sendMutation = useMutation({
    mutationFn: async ({ text, address }: { text: string; address?: string }) => {
      const res = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, address }),
      });
      if (!res.ok) throw new Error("Failed to send");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat"] });
    },
  });

  // Ably real-time for new messages
  useEffect(() => {
    let channel: any = null;
    let client: any = null;

    async function subscribe() {
      try {
        const tokenCheck = await fetch("/api/ably-token").then(r => r.json());
        if (tokenCheck.mock) return;

        const Ably = (await import("ably")).default;
        client = new Ably.Realtime({ authUrl: "/api/ably-token" });
        channel = client.channels.get(CHANNELS.BETS); // chat shares bets channel

        channel.subscribe("chat_message", (msg: any) => {
          queryClient.setQueryData(["chat"], (old: { messages: ChatMessage[] } | undefined) => {
            if (!old) return { messages: [msg.data] };
            return { messages: [...old.messages, msg.data].slice(-200) };
          });
        });
      } catch {
        // polling handles it
      }
    }

    subscribe();
    return () => {
      try { channel?.unsubscribe(); } catch {}
      try { client?.close(); } catch {}
    };
  }, [queryClient]);

  return {
    messages: query.data?.messages ?? [],
    sendMessage: (text: string, address?: string) => sendMutation.mutate({ text, address }),
    isLoading: query.isLoading,
    isSending: sendMutation.isPending,
  };
}
