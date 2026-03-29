"use client";

import { useCallback } from "react";
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from "wagmi";
import { formatEther } from "viem";
import { MARKET_ABI } from "@/lib/contracts";

/**
 * Claims winnings from a resolved PredictionMarket.
 * No mock mode — if no market address, the hook returns disabled state.
 */
export function useClaimWinnings(marketAddress: `0x${string}` | null) {
  const { address: userAddress } = useAccount();
  const enabled = !!marketAddress && !!userAddress;

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
    if (!marketAddress) return;

    reset();
    writeContract({
      address: marketAddress,
      abi: MARKET_ABI,
      functionName: "claimWinnings",
    });
  }, [marketAddress, writeContract, reset]);

  const claimableWei = (claimableData as bigint) ?? BigInt(0);

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
