"use client";

/**
 * Minimal local store for the TapTrade arena gamification widgets
 * (confetti trigger, win streak counters). The standalone repo used
 * Zustand; here we use React context to avoid a new dep — the only
 * subscribers are the ported `gamification/*` components, mounted
 * once under `RushArenaTradePage`.
 *
 * `setShowConfetti` flips a boolean the confetti renderer reads;
 * `recordWin` / `recordLoss` advance the streak counters. The
 * trading page calls these locally on `BetResolved` events instead
 * of routing through a global store.
 */

import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";

interface GamificationState {
  showConfetti: boolean;
  setShowConfetti: (v: boolean) => void;
  currentStreak: number;
  maxStreak: number;
  recordWin: () => void;
  recordLoss: () => void;
}

const defaultState: GamificationState = {
  showConfetti: false,
  setShowConfetti: () => {},
  currentStreak: 0,
  maxStreak: 0,
  recordWin: () => {},
  recordLoss: () => {},
};

const GamificationContext = createContext<GamificationState>(defaultState);

export function GamificationProvider({ children }: { children: ReactNode }) {
  const [showConfetti, setShowConfetti] = useState(false);
  const [currentStreak, setCurrentStreak] = useState(0);
  const [maxStreak, setMaxStreak] = useState(0);

  const recordWin = useCallback(() => {
    setCurrentStreak((s) => {
      const next = s + 1;
      setMaxStreak((m) => Math.max(m, next));
      return next;
    });
  }, []);
  const recordLoss = useCallback(() => {
    setCurrentStreak(0);
  }, []);

  return (
    <GamificationContext.Provider
      value={{
        showConfetti,
        setShowConfetti,
        currentStreak,
        maxStreak,
        recordWin,
        recordLoss,
      }}
    >
      {children}
    </GamificationContext.Provider>
  );
}

export function useGamification() {
  return useContext(GamificationContext);
}
