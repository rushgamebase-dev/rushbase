"use client";

import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/fetcher";
import type { BetRecord } from "@/lib/api-types";

interface PlaceBetResult {
  placeBet: (outcomeId: string, outcomeLabel: string, amountEth: string, odds: number) => Promise<string | null>;
  isLoading: boolean;
  isSuccess: boolean;
  error: string | null;
  txHash: string | null;
  reset: () => void;
}

export function usePlaceBet(marketAddress: string | null): PlaceBetResult {
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const reset = useCallback(() => {
    setIsLoading(false);
    setIsSuccess(false);
    setError(null);
    setTxHash(null);
  }, []);

  const placeBet = useCallback(
    async (outcomeId: string, outcomeLabel: string, amountEth: string, odds: number): Promise<string | null> => {
      if (!marketAddress) {
        setError("No market address");
        return null;
      }

      setIsLoading(true);
      setError(null);
      setIsSuccess(false);

      try {
        // Generate a mock txHash (in production this comes from the wallet)
        const fakeTxHash = `0x${Array.from({ length: 64 }, () =>
          Math.floor(Math.random() * 16).toString(16)
        ).join("")}`;

        // POST to API
        const result = await fetchApi<{ ok: boolean; bet: BetRecord }>(
          `/api/markets/${marketAddress}/bet`,
          {
            method: "POST",
            body: JSON.stringify({
              user: "0x0000000000000000000000000000000000000000", // placeholder until wallet connected
              outcomeId,
              outcomeLabel,
              amount: amountEth,
              odds,
              txHash: fakeTxHash,
            }),
          }
        );

        const hash = result.bet?.txHash || fakeTxHash;
        setTxHash(hash);
        setIsSuccess(true);

        // Invalidate related queries so they refetch
        queryClient.invalidateQueries({ queryKey: ["odds", marketAddress] });
        queryClient.invalidateQueries({ queryKey: ["market", marketAddress] });
        queryClient.invalidateQueries({ queryKey: ["activity"] });
        queryClient.invalidateQueries({ queryKey: ["stats"] });

        setIsLoading(false);
        return hash;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Transaction failed");
        setIsLoading(false);
        return null;
      }
    },
    [marketAddress, queryClient]
  );

  return { placeBet, isLoading, isSuccess, error, txHash, reset };
}
