import { StateCreator } from "zustand";

export interface GamificationSlice {
  currentStreak: number;
  maxStreak: number;
  totalWins: number;
  totalLosses: number;
  lastTradeResult: "win" | "loss" | null;
  showConfetti: boolean;

  incrementStreak: () => void;
  resetStreak: () => void;
  recordWin: () => void;
  recordLoss: () => void;
  setShowConfetti: (show: boolean) => void;
  loadStats: (stats: {
    currentStreak: number;
    maxStreak: number;
    totalWins: number;
    totalLosses: number;
  }) => void;
}

export const createGamificationSlice: StateCreator<GamificationSlice> = (set, get) => ({
  currentStreak: 0,
  maxStreak: 0,
  totalWins: 0,
  totalLosses: 0,
  lastTradeResult: null,
  showConfetti: false,

  incrementStreak: () => {
    const { currentStreak, maxStreak } = get();
    const newStreak = currentStreak + 1;
    set({
      currentStreak: newStreak,
      maxStreak: Math.max(newStreak, maxStreak),
    });
  },

  resetStreak: () => set({ currentStreak: 0 }),

  recordWin: () => {
    const { totalWins, currentStreak, maxStreak } = get();
    const newStreak = currentStreak + 1;
    set({
      totalWins: totalWins + 1,
      currentStreak: newStreak,
      maxStreak: Math.max(newStreak, maxStreak),
      lastTradeResult: "win",
      showConfetti: true,
    });

    // Auto-hide confetti after 3 seconds
    setTimeout(() => {
      set({ showConfetti: false });
    }, 3000);
  },

  recordLoss: () => {
    const { totalLosses } = get();
    set({
      totalLosses: totalLosses + 1,
      currentStreak: 0,
      lastTradeResult: "loss",
    });
  },

  setShowConfetti: (show) => set({ showConfetti: show }),

  loadStats: (stats) => set(stats),
});
