"use client";

import { useState, useCallback, useRef } from "react";

// =============================================================================
// SCREEN SHAKE HOOK - Adds Impactful Screen Shake Effects
// =============================================================================

export type ShakeType = 'win' | 'loss' | 'bigWin' | 'bigLoss' | 'streak' | 'levelUp' | 'light' | 'heavy';

interface ShakeConfig {
  intensity: number;
  duration: number;
  frequency: number;
}

const SHAKE_CONFIGS: Record<ShakeType, ShakeConfig> = {
  light: { intensity: 2, duration: 150, frequency: 50 },
  win: { intensity: 4, duration: 200, frequency: 40 },
  loss: { intensity: 3, duration: 150, frequency: 30 },
  bigWin: { intensity: 10, duration: 500, frequency: 25 },
  bigLoss: { intensity: 8, duration: 400, frequency: 30 },
  streak: { intensity: 6, duration: 300, frequency: 35 },
  levelUp: { intensity: 12, duration: 600, frequency: 20 },
  heavy: { intensity: 15, duration: 400, frequency: 20 },
};

export function useScreenShake() {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const animationRef = useRef<number>(0);
  const isShakingRef = useRef(false);

  const shake = useCallback((type: ShakeType = 'light') => {
    if (isShakingRef.current) return;

    const config = SHAKE_CONFIGS[type];
    isShakingRef.current = true;

    const startTime = performance.now();

    const animate = (time: number) => {
      const elapsed = time - startTime;
      const progress = elapsed / config.duration;

      if (progress >= 1) {
        setOffset({ x: 0, y: 0 });
        isShakingRef.current = false;
        return;
      }

      // Decay the intensity over time
      const decay = 1 - progress;
      const currentIntensity = config.intensity * decay;

      // Calculate shake offset using sine waves at different frequencies
      const x = Math.sin(elapsed * 0.03 * config.frequency) * currentIntensity;
      const y = Math.cos(elapsed * 0.025 * config.frequency) * currentIntensity * 0.8;

      setOffset({ x, y });
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);
  }, []);

  const stop = useCallback(() => {
    cancelAnimationFrame(animationRef.current);
    setOffset({ x: 0, y: 0 });
    isShakingRef.current = false;
  }, []);

  // Convenience methods
  const shakeWin = useCallback(() => shake('win'), [shake]);
  const shakeLoss = useCallback(() => shake('loss'), [shake]);
  const shakeBigWin = useCallback(() => shake('bigWin'), [shake]);
  const shakeBigLoss = useCallback(() => shake('bigLoss'), [shake]);
  const shakeStreak = useCallback(() => shake('streak'), [shake]);
  const shakeLevelUp = useCallback(() => shake('levelUp'), [shake]);

  const style = {
    transform: `translate(${offset.x}px, ${offset.y}px)`,
  };

  return {
    offset,
    style,
    shake,
    stop,
    shakeWin,
    shakeLoss,
    shakeBigWin,
    shakeBigLoss,
    shakeStreak,
    shakeLevelUp,
  };
}
