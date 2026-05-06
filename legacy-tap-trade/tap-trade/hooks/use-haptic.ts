"use client";

import { useCallback } from "react";

type HapticType = "light" | "medium" | "heavy" | "success" | "error";

const patterns: Record<HapticType, number[]> = {
  light: [10],
  medium: [20],
  heavy: [50],
  success: [10, 50, 10],
  error: [50, 30, 50],
};

export function useHaptic() {
  const triggerHaptic = useCallback((type: HapticType = "medium") => {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate(patterns[type]);
      } catch {
        // Vibration not supported
      }
    }
  }, []);

  const hapticTap = useCallback(() => triggerHaptic("light"), [triggerHaptic]);
  const hapticMedium = useCallback(() => triggerHaptic("medium"), [triggerHaptic]);
  const hapticHeavy = useCallback(() => triggerHaptic("heavy"), [triggerHaptic]);
  const hapticSuccess = useCallback(() => triggerHaptic("success"), [triggerHaptic]);
  const hapticError = useCallback(() => triggerHaptic("error"), [triggerHaptic]);

  return {
    triggerHaptic,
    hapticTap,
    hapticMedium,
    hapticHeavy,
    hapticSuccess,
    hapticError,
  };
}
