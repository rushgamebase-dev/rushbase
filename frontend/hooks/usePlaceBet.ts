"use client";

import { useState, useCallback } from "react";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseEther } from "viem";
import { MARKET_ABI } from "@/lib/contracts";
import { IS_DEMO_MODE } from "@/lib/mock";

/**
 * Places an ETH bet on a PredictionMarket.
 * Falls back to mock (setTimeout) if no market address.
 */
export function usePlaceBet(marketAddress: `0x${string}` | null) {
  const [mockLoading, setMockLoading] = useState(false);
  const [mockSuccess, setMockSuccess] = useState(false);
  const [mockError, setMockError] = useState<string | null>(null);
  const [mockTxHash, setMockTxHash] = useState<string | null>(null);

  const {
    writeContract,
    data: txHash,
    isPending: isWritePending,
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
      if (IS_DEMO_MODE || !marketAddress) {
        // Mock mode
        setMockLoading(true);
        setMockSuccess(false);
        setMockError(null);
        const fakeTx = "0x" + Math.random().toString(16).slice(2).padEnd(64, "0");
        setMockTxHash(fakeTx);

        await new Promise((r) => setTimeout(r, 1400));
        setMockLoading(false);
        setMockSuccess(true);
        return;
      }

      // Real contract call
      reset();
      writeContract({
        address: marketAddress,
        abi: MARKET_ABI,
        functionName: "placeBet",
        args: [BigInt(rangeIndex)],
        value: parseEther(amountEth),
      });
    },
    [marketAddress, writeContract, reset]
  );

  if (IS_DEMO_MODE || !marketAddress) {
    return {
      placeBet,
      isLoading: mockLoading,
      isSuccess: mockSuccess,
      error: mockError,
      txHash: mockTxHash as `0x${string}` | null,
      isConfirming: false,
      reset: () => {
        setMockSuccess(false);
        setMockError(null);
        setMockTxHash(null);
      },
    };
  }

  return {
    placeBet,
    isLoading: isWritePending || isConfirming,
    isSuccess: isConfirmed,
    error: writeError ? writeError.message : null,
    txHash: txHash ?? null,
    isConfirming,
    reset,
  };
}
