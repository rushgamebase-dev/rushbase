"use client";

import { useState, useCallback } from "react";
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from "wagmi";
import { formatEther } from "viem";
import { MARKET_ABI } from "@/lib/contracts";
import { IS_DEMO_MODE } from "@/lib/mock";

/**
 * Claims winnings from a resolved PredictionMarket.
 */
export function useClaimWinnings(marketAddress: `0x${string}` | null) {
  const { address: userAddress } = useAccount();
  const enabled = !IS_DEMO_MODE && !!marketAddress && !!userAddress;

  const [mockLoading, setMockLoading] = useState(false);
  const [mockTxHash, setMockTxHash] = useState<string | null>(null);

  // Read claimable amount
  const { data: claimableData } = useReadContract({
    address: marketAddress || undefined,
    abi: MARKET_ABI,
    functionName: "getUserClaimable",
    args: userAddress ? [userAddress] : undefined,
    query: { enabled, refetchInterval: 10_000 },
  });

  // Is market claimable
  const { data: isClaimableData } = useReadContract({
    address: marketAddress || undefined,
    abi: MARKET_ABI,
    functionName: "isClaimable",
    query: { enabled },
  });

  // Write
  const {
    writeContract,
    data: txHash,
    isPending: isWritePending,
    error: writeError,
    reset,
  } = useWriteContract();

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash: txHash });

  const claim = useCallback(async () => {
    if (IS_DEMO_MODE || !marketAddress) {
      setMockLoading(true);
      const fakeTx = "0x" + Math.random().toString(16).slice(2).padEnd(64, "0");
      setMockTxHash(fakeTx);
      await new Promise((r) => setTimeout(r, 1400));
      setMockLoading(false);
      return;
    }

    reset();
    writeContract({
      address: marketAddress,
      abi: MARKET_ABI,
      functionName: "claimWinnings",
    });
  }, [marketAddress, writeContract, reset]);

  const claimableWei = (claimableData as bigint) ?? BigInt(0);

  if (IS_DEMO_MODE || !marketAddress) {
    return {
      claim,
      claimable: "0",
      claimableWei: BigInt(0),
      isClaimable: false,
      isLoading: mockLoading,
      isSuccess: false,
      txHash: mockTxHash as `0x${string}` | null,
      error: null,
    };
  }

  return {
    claim,
    claimable: formatEther(claimableWei),
    claimableWei,
    isClaimable: (isClaimableData as boolean) ?? false,
    isLoading: isWritePending || isConfirming,
    isSuccess: isConfirmed,
    txHash: txHash ?? null,
    error: writeError ? writeError.message : null,
  };
}
