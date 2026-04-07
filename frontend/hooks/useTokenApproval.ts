"use client";

import { useCallback } from "react";
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from "wagmi";
import { ERC20_ABI, RUSH_TOKEN_ADDRESS } from "@/lib/contracts";

export function useTokenApproval(
  spenderAddress: `0x${string}` | null,
  requiredAmount: bigint = BigInt(0),
) {
  const { address: userAddress } = useAccount();
  const enabled = !!spenderAddress && !!userAddress;

  const { data: balanceData, refetch: refetchBalance } = useReadContract({
    address: RUSH_TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: userAddress ? [userAddress] : undefined,
    query: { enabled, refetchInterval: 15_000 },
  });

  const { data: allowanceData, refetch: refetchAllowance } = useReadContract({
    address: RUSH_TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: userAddress && spenderAddress ? [userAddress, spenderAddress] : undefined,
    query: { enabled, refetchInterval: 10_000 },
  });

  const {
    writeContract,
    data: txHash,
    isPending,
    error: writeError,
    reset,
  } = useWriteContract();

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash: txHash });

  if (isConfirmed) {
    refetchAllowance();
    refetchBalance();
  }

  const approve = useCallback(
    async (amount: bigint) => {
      if (!spenderAddress) return;
      reset();
      writeContract({
        address: RUSH_TOKEN_ADDRESS,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [spenderAddress, amount],
      });
    },
    [spenderAddress, writeContract, reset],
  );

  const balance = (balanceData as bigint) ?? BigInt(0);
  const allowance = (allowanceData as bigint) ?? BigInt(0);
  const needsApproval = requiredAmount > BigInt(0) && allowance < requiredAmount;

  return {
    balance,
    allowance,
    needsApproval,
    approve,
    isApproving: isPending || isConfirming,
    isApproved: isConfirmed,
    txHash: txHash ?? null,
    error: writeError ? writeError.message : null,
    reset,
  };
}
