"use client";

import { useState, useCallback } from "react";
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from "wagmi";
import { formatEther, parseEther } from "viem";
import { RUSH_TILES_ABI, RUSH_TILES_ADDRESS } from "@/lib/contracts";
import { IS_DEMO_MODE } from "@/lib/mock";

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
 * Falls back to mock if RUSH_TILES_ADDRESS is empty.
 */
export function useTilesContract() {
  const { address: userAddress } = useAccount();
  const enabled = !IS_DEMO_MODE && !!RUSH_TILES_ADDRESS;
  const addr = RUSH_TILES_ADDRESS || undefined;

  const [mockLoading, setMockLoading] = useState(false);
  const [mockTxHash, setMockTxHash] = useState<string | null>(null);

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

  // Helper for mock fallback
  const mockAction = useCallback(async () => {
    setMockLoading(true);
    const fakeTx = "0x" + Math.random().toString(16).slice(2).padEnd(64, "0");
    setMockTxHash(fakeTx);
    await new Promise((r) => setTimeout(r, 1200));
    setMockLoading(false);
  }, []);

  // --- Write actions ---

  const claimTile = useCallback(
    async (tileIndex: number, priceEth: string, depositEth: string) => {
      if (!enabled) return mockAction();
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
    [enabled, writeContract, reset, mockAction]
  );

  const buyoutTile = useCallback(
    async (tileIndex: number, newPriceEth: string, totalCostEth: string) => {
      if (!enabled) return mockAction();
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
    [enabled, writeContract, reset, mockAction]
  );

  const abandonTile = useCallback(
    async (tileIndex: number) => {
      if (!enabled) return mockAction();
      reset();
      writeContract({
        address: RUSH_TILES_ADDRESS,
        abi: RUSH_TILES_ABI,
        functionName: "abandonTile",
        args: [tileIndex],
      });
    },
    [enabled, writeContract, reset, mockAction]
  );

  const setPrice = useCallback(
    async (tileIndex: number, newPriceEth: string, appTaxEth?: string) => {
      if (!enabled) return mockAction();
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
    [enabled, writeContract, reset, mockAction]
  );

  const claimFees = useCallback(async () => {
    if (!enabled) return mockAction();
    reset();
    writeContract({
      address: RUSH_TILES_ADDRESS,
      abi: RUSH_TILES_ABI,
      functionName: "claimFees",
    });
  }, [enabled, writeContract, reset, mockAction]);

  const distributeFees = useCallback(async () => {
    if (!enabled) return mockAction();
    reset();
    writeContract({
      address: RUSH_TILES_ADDRESS,
      abi: RUSH_TILES_ABI,
      functionName: "distributeFees",
    });
  }, [enabled, writeContract, reset, mockAction]);

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
    isLoading: IS_DEMO_MODE ? mockLoading : isWritePending || isConfirming,
    isSuccess: IS_DEMO_MODE ? false : isConfirmed,
    txHash: IS_DEMO_MODE ? (mockTxHash as `0x${string}` | null) : (txHash ?? null),
    error: writeError ? writeError.message : null,
    isDemoMode: IS_DEMO_MODE,
  };
}
