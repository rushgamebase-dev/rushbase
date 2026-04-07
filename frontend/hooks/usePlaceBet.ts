"use client";

import { useCallback } from "react";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseEther, parseUnits } from "viem";
import { MARKET_ABI } from "@/lib/contracts";

/**
 * Places a bet on a PredictionMarket or BurnMarket.
 *
 * ETH mode:   placeBet(rangeIndex) with msg.value
 * Token mode: placeBetToken(rangeIndex, amountWei) — requires prior approval
 */
export function usePlaceBet(
  marketAddress: `0x${string}` | null,
  isTokenMode = false,
  tokenDecimals = 18,
) {
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
  } = useWaitForTransactionReceipt({ hash: txHash });

  const txSucceeded = isConfirmed && receipt?.status === "success";

  const placeBet = useCallback(
    async (rangeIndex: number, amountStr: string) => {
      if (!marketAddress) return;
      reset();

      if (isTokenMode) {
        const amountWei = parseUnits(amountStr, tokenDecimals);
        writeContract({
          address: marketAddress,
          abi: MARKET_ABI,
          functionName: "placeBetToken",
          args: [BigInt(rangeIndex), amountWei],
        });
      } else {
        writeContract({
          address: marketAddress,
          abi: MARKET_ABI,
          functionName: "placeBet",
          args: [BigInt(rangeIndex)],
          value: parseEther(amountStr),
        });
      }
    },
    [marketAddress, isTokenMode, tokenDecimals, writeContract, reset],
  );

  return {
    placeBet,
    isLoading: isPending || isConfirming,
    isSuccess: txSucceeded,
    error: writeError
      ? writeError.message
      : isConfirmed && !txSucceeded
      ? "Transaction reverted"
      : null,
    txHash: txHash ?? null,
    isConfirming,
    reset,
  };
}
