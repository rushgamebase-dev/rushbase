import { StateCreator } from "zustand";
import type { Balance } from "@/types";
import { userApi } from "@/lib/api";

export interface BalanceSlice {
  balance: Balance;
  isLoadingBalance: boolean;

  updateBalance: (balance: Balance) => void;
  fetchBalance: () => Promise<void>;
}

export const createBalanceSlice: StateCreator<BalanceSlice> = (set) => ({
  balance: {
    availableBalance: 0,
    lockedBalance: 0,
    totalBalance: 0,
  },
  isLoadingBalance: false,

  updateBalance: (balance) => set({ balance }),

  fetchBalance: async () => {
    set({ isLoadingBalance: true });
    try {
      const balance = await userApi.getBalance();
      set({ balance, isLoadingBalance: false });
    } catch (error) {
      console.error("Failed to fetch balance:", error);
      set({ isLoadingBalance: false });
    }
  },
});
