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
    data: receipt,
    isLoading: isConfirming,
    isSuccess: isConfirmed,
  } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // TX must be confirmed AND not reverted (status === "success")
  const txSucceeded = isConfirmed && receipt?.status === "success";

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
    isSuccess: txSucceeded,
    error: writeError ? writeError.message : (isConfirmed && !txSucceeded) ? "Transaction reverted" : null,
    txHash: txHash ?? null,
    isConfirming,
    reset,
  };
}
