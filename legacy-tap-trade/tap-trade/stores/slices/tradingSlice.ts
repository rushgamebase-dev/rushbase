import { StateCreator } from "zustand";
import type { Asset, Direction, Leverage, PositionWithPnL } from "@/types";
import { tradingApi } from "@/lib/api";

export interface TradingSlice {
  // Trading state
  selectedAsset: Asset;
  selectedLeverage: Leverage;
  stakeAmount: number;
  activePosition: PositionWithPnL | null;
  isOpeningPosition: boolean;
  isClosingPosition: boolean;

  // Actions
  setSelectedAsset: (asset: Asset) => void;
  setSelectedLeverage: (leverage: Leverage) => void;
  setStakeAmount: (amount: number) => void;
  setActivePosition: (position: PositionWithPnL | null) => void;
  updatePositionPnL: (
    positionId: string,
    pnlData: {
      currentPrice: number;
      unrealizedPnl: number;
      roePercent: number;
      marginRatio: number;
      distanceToLiqPercent: number;
    }
  ) => void;
  openPosition: (direction: Direction) => Promise<void>;
  closePosition: () => Promise<{ realizedPnl: number }>;
  fetchActivePosition: () => Promise<void>;
}

export const createTradingSlice: StateCreator<TradingSlice> = (set, get) => ({
  selectedAsset: "BTCUSDT",
  selectedLeverage: 10,
  stakeAmount: 100,
  activePosition: null,
  isOpeningPosition: false,
  isClosingPosition: false,

  setSelectedAsset: (asset) => set({ selectedAsset: asset }),

  setSelectedLeverage: (leverage) => set({ selectedLeverage: leverage }),

  setStakeAmount: (amount) => set({ stakeAmount: amount }),

  setActivePosition: (position) => set({ activePosition: position }),

  updatePositionPnL: (positionId, pnlData) => {
    const { activePosition } = get();
    if (activePosition && activePosition.id === positionId) {
      set({
        activePosition: {
          ...activePosition,
          ...pnlData,
        },
      });
    }
  },

  openPosition: async (direction) => {
    const { selectedAsset, selectedLeverage, stakeAmount } = get();
    set({ isOpeningPosition: true });

    try {
      const position = await tradingApi.openPosition(
        selectedAsset,
        direction,
        stakeAmount,
        selectedLeverage
      );

      set({
        activePosition: {
          ...position,
          currentPrice: position.entryPrice,
          unrealizedPnl: 0,
          roePercent: 0,
          marginRatio: 100,
          distanceToLiqPercent: 100,
        },
        isOpeningPosition: false,
      });
    } catch (error) {
      set({ isOpeningPosition: false });
      throw error;
    }
  },

  closePosition: async () => {
    const { activePosition } = get();
    if (!activePosition) {
      throw new Error("No active position");
    }

    set({ isClosingPosition: true });

    try {
      const result = await tradingApi.closePosition(activePosition.id);
      set({
        activePosition: null,
        isClosingPosition: false,
      });
      return { realizedPnl: result.realizedPnl };
    } catch (error) {
      set({ isClosingPosition: false });
      throw error;
    }
  },

  fetchActivePosition: async () => {
    try {
      const positions = await tradingApi.getOpenPositions();
      if (positions.length > 0) {
        set({ activePosition: positions[0] });
      } else {
        set({ activePosition: null });
      }
    } catch (error) {
      console.error("Failed to fetch active position:", error);
    }
  },
});
