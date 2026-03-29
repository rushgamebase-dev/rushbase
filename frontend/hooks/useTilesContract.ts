"use client";

import { useCallback } from "react";
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from "wagmi";
import { formatEther, parseEther } from "viem";
import { RUSH_TILES_ABI, RUSH_TILES_ADDRESS } from "@/lib/contracts";

export interface TileDataOnChain {
  owner: string;
  price: bigint;
  deposit: bigint;
  lastTaxTime: number;
  lastBuyoutTime: number;
}

export interface PlayerStateOnChain {
  rewardSnapshot: bigint;
  accumulatedFees: bigint;
  tileCount: number;
  tilesOwned: number[];
}

/**
 * Reads and writes to RushTiles contract.
 * If RUSH_TILES_ADDRESS is not set, all reads return empty/zero and writes are no-ops.
 */
export function useTilesContract() {
  const { address: userAddress } = useAccount();
  const enabled = !!RUSH_TILES_ADDRESS;
  const addr = RUSH_TILES_ADDRESS || undefined;

  // Read all tiles
  const { data: allTilesData, refetch: refetchTiles } = useReadContract({
    address: addr,
    abi: RUSH_TILES_ABI,
    functionName: "getAllTiles",
    query: { enabled, refetchInterval: 15_000 },
  });

  // Read player state
  const { data: playerData, refetch: refetchPlayer } = useReadContract({
    address: addr,
    abi: RUSH_TILES_ABI,
    functionName: "getPlayer",
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: enabled && !!userAddress, refetchInterval: 15_000 },
  });

  // Read pending fees
  const { data: pendingFeesData, refetch: refetchFees } = useReadContract({
    address: addr,
    abi: RUSH_TILES_ABI,
    functionName: "pendingFees",
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: enabled && !!userAddress, refetchInterval: 15_000 },
  });

  // Read total active tiles
  const { data: totalActiveTilesData } = useReadContract({
    address: addr,
    abi: RUSH_TILES_ABI,
    functionName: "totalActiveTiles",
    query: { enabled },
  });

  // Read total distributed
  const { data: totalDistributedData } = useReadContract({
    address: addr,
    abi: RUSH_TILES_ABI,
    functionName: "totalDistributed",
    query: { enabled },
  });

  // Read treasury balance
  const { data: treasuryBalanceData } = useReadContract({
    address: addr,
    abi: RUSH_TILES_ABI,
    functionName: "treasuryBalance",
    query: { enabled },
  });

  // Write contract
  const {
    writeContract,
    data: txHash,
    isPending: isWritePending,
    error: writeError,
    reset,
  } = useWriteContract();

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash: txHash });

  // --- Write actions ---

  const claimTile = useCallback(
    async (tileIndex: number, priceEth: string, depositEth: string) => {
      if (!enabled) return;
      reset();
      const price = parseEther(priceEth);
      const value = parseEther(depositEth);
      writeContract({
        address: RUSH_TILES_ADDRESS,
        abi: RUSH_TILES_ABI,
        functionName: "claimTile",
        args: [tileIndex, price],
        value,
      });
    },
    [enabled, writeContract, reset]
  );

  const buyoutTile = useCallback(
    async (tileIndex: number, newPriceEth: string, totalCostEth: string) => {
      if (!enabled) return;
      reset();
      const newPrice = parseEther(newPriceEth);
      const value = parseEther(totalCostEth);
      writeContract({
        address: RUSH_TILES_ADDRESS,
        abi: RUSH_TILES_ABI,
        functionName: "buyoutTile",
        args: [tileIndex, newPrice],
        value,
      });
    },
    [enabled, writeContract, reset]
  );

  const abandonTile = useCallback(
    async (tileIndex: number) => {
      if (!enabled) return;
      reset();
      writeContract({
        address: RUSH_TILES_ADDRESS,
        abi: RUSH_TILES_ABI,
        functionName: "abandonTile",
        args: [tileIndex],
      });
    },
    [enabled, writeContract, reset]
  );

  const setPrice = useCallback(
    async (tileIndex: number, newPriceEth: string, appTaxEth?: string) => {
      if (!enabled) return;
      reset();
      const newPrice = parseEther(newPriceEth);
      const value = appTaxEth ? parseEther(appTaxEth) : BigInt(0);
      writeContract({
        address: RUSH_TILES_ADDRESS,
        abi: RUSH_TILES_ABI,
        functionName: "setPrice",
        args: [tileIndex, newPrice],
        value,
      });
    },
    [enabled, writeContract, reset]
  );

  const claimFees = useCallback(async () => {
    if (!enabled) return;
    reset();
    writeContract({
      address: RUSH_TILES_ADDRESS,
      abi: RUSH_TILES_ABI,
      functionName: "claimFees",
    });
  }, [enabled, writeContract, reset]);

  const distributeFees = useCallback(async () => {
    if (!enabled) return;
    reset();
    writeContract({
      address: RUSH_TILES_ADDRESS,
      abi: RUSH_TILES_ABI,
      functionName: "distributeFees",
    });
  }, [enabled, writeContract, reset]);

  // --- Parse data ---

  const pendingFeesWei = (pendingFeesData as bigint) ?? BigInt(0);
  const totalActiveTiles = totalActiveTilesData ? Number(totalActiveTilesData) : 0;
  const totalDistributedWei = (totalDistributedData as bigint) ?? BigInt(0);
  const treasuryBalanceWei = (treasuryBalanceData as bigint) ?? BigInt(0);

  // Parse player
  const player: PlayerStateOnChain | null = playerData
    ? {
        rewardSnapshot: (playerData as { rewardSnapshot: bigint }).rewardSnapshot,
        accumulatedFees: (playerData as { accumulatedFees: bigint }).accumulatedFees,
        tileCount: Number((playerData as { tileCount: number }).tileCount),
        tilesOwned: (playerData as unknown as { tilesOwned: number[] }).tilesOwned?.map(Number) ?? [],
      }
    : null;

  // Parse tiles array
  const tiles: TileDataOnChain[] = allTilesData
    ? (allTilesData as Array<{
        owner: string;
        price: bigint;
        deposit: bigint;
        lastTaxTime: number;
        lastBuyoutTime: number;
      }>).map((t) => ({
        owner: t.owner,
        price: t.price,
        deposit: t.deposit,
        lastTaxTime: Number(t.lastTaxTime),
        lastBuyoutTime: Number(t.lastBuyoutTime),
      }))
    : [];

  const refetchAll = useCallback(() => {
    refetchTiles();
    refetchPlayer();
    refetchFees();
  }, [refetchTiles, refetchPlayer, refetchFees]);

  return {
    // Data
    tiles,
    player,
    pendingFees: formatEther(pendingFeesWei),
    pendingFeesWei,
    totalActiveTiles,
    totalDistributed: formatEther(totalDistributedWei),
    totalDistributedWei,
    treasuryBalance: formatEther(treasuryBalanceWei),
    treasuryBalanceWei,

    // Actions
    claimTile,
    buyoutTile,
    abandonTile,
    setPrice,
    claimFees,
    distributeFees,
    refetchAll,

    // Status
    isLoading: isWritePending || isConfirming,
    isSuccess: isConfirmed,
    txHash: txHash ?? null,
    error: writeError ? writeError.message : null,
  };
}
