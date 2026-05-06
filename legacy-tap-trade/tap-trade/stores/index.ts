import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { createAuthSlice, AuthSlice } from "./slices/authSlice";
import { createTradingSlice, TradingSlice } from "./slices/tradingSlice";
import { createPriceSlice, PriceSlice } from "./slices/priceSlice";
import { createBalanceSlice, BalanceSlice } from "./slices/balanceSlice";
import { createGamificationSlice, GamificationSlice } from "./slices/gamificationSlice";

export type StoreState = AuthSlice &
  TradingSlice &
  PriceSlice &
  BalanceSlice &
  GamificationSlice;

export const useStore = create<StoreState>()(
  devtools(
    persist(
      (...a) => ({
        ...createAuthSlice(...a),
        ...createTradingSlice(...a),
        ...createPriceSlice(...a),
        ...createBalanceSlice(...a),
        ...createGamificationSlice(...a),
      }),
      {
        name: "tap-trading-store",
        partialize: (state) => ({
          // Only persist these fields
          selectedAsset: state.selectedAsset,
          selectedLeverage: state.selectedLeverage,
          stakeAmount: state.stakeAmount,
        }),
      }
    )
  )
);

// Selector hooks for better performance
export const useAuth = () =>
  useStore((state) => ({
    user: state.user,
    isAuthenticated: state.isAuthenticated,
    isLoading: state.isLoading,
    error: state.error,
    login: state.login,
    register: state.register,
    logout: state.logout,
    setUser: state.setUser,
    clearError: state.clearError,
  }));

export const useTrading = () =>
  useStore((state) => ({
    selectedAsset: state.selectedAsset,
    selectedLeverage: state.selectedLeverage,
    stakeAmount: state.stakeAmount,
    activePosition: state.activePosition,
    isOpeningPosition: state.isOpeningPosition,
    isClosingPosition: state.isClosingPosition,
    setSelectedAsset: state.setSelectedAsset,
    setSelectedLeverage: state.setSelectedLeverage,
    setStakeAmount: state.setStakeAmount,
    setActivePosition: state.setActivePosition,
    updatePositionPnL: state.updatePositionPnL,
    openPosition: state.openPosition,
    closePosition: state.closePosition,
    fetchActivePosition: state.fetchActivePosition,
  }));

export const usePrices = () =>
  useStore((state) => ({
    prices: state.prices,
    priceHistory: state.priceHistory,
    lastUpdate: state.lastUpdate,
    updatePrice: state.updatePrice,
    updatePrices: state.updatePrices,
    fetchPrices: state.fetchPrices,
    getPrice: state.getPrice,
  }));

export const useBalance = () =>
  useStore((state) => ({
    balance: state.balance,
    isLoadingBalance: state.isLoadingBalance,
    updateBalance: state.updateBalance,
    fetchBalance: state.fetchBalance,
  }));

export const useGamification = () =>
  useStore((state) => ({
    currentStreak: state.currentStreak,
    maxStreak: state.maxStreak,
    totalWins: state.totalWins,
    totalLosses: state.totalLosses,
    lastTradeResult: state.lastTradeResult,
    showConfetti: state.showConfetti,
    incrementStreak: state.incrementStreak,
    resetStreak: state.resetStreak,
    recordWin: state.recordWin,
    recordLoss: state.recordLoss,
    setShowConfetti: state.setShowConfetti,
    loadStats: state.loadStats,
  }));
