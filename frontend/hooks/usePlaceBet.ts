"use client";

import { useCallback } from "react";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseEther } from "viem";
import { MARKET_ABI } from "@/lib/contracts";

/**
 * Places an ETH bet on a PredictionMarket.
 * No mock mode — if no market address, bet button is disabled upstream.
 */
export function usePlaceBet(marketAddress: `0x${string}` | null) {
  const {
    writeContract,
    data: txHash,
    isPending,
    error: writeError,
    reset,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
  } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  const placeBet = useCallback(
    async (rangeIndex: number, amountEth: string) => {
      if (!marketAddress) return;

      reset();
      writeContract({
        address: marketAddress,
        abi: MARKET_ABI,
        functionName: "placeBet",
        args: [BigInt(rangeIndex)],
        value: parseEther(amountEth),
      });
    },
    [marketAddress, writeContract, reset],
  );

  return {
    placeBet,
    isLoading: isPending || isConfirming,
    isSuccess: isConfirmed,
    error: writeError ? writeError.message : null,
    txHash: txHash ?? null,
    isConfirming,
    reset,
  };
}
