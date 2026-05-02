"use client";

import { createContext, useContext, useCallback, useState, useEffect, useRef, ReactNode } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { motion } from "framer-motion";

// =============================================================================
// SOUND MANAGER - Modern Minimalist Game Sounds
// Satisfying, subtle UI feedback using Web Audio API
// Inspired by 2025 mobile game sound design trends
// =============================================================================

type SoundType =
  | "tap"
  | "bet"
  | "win"
  | "loss"
  | "bigWin"
  | "streak"
  | "levelUp"
  | "achievement"
  | "error"
  | "countdown";

interface SoundManagerContextType {
  enabled: boolean;
  volume: number;
  toggleSound: () => void;
  setVolume: (volume: number) => void;
  playSound: (type: SoundType) => void;
}

const SoundManagerContext = createContext<SoundManagerContextType>({
  enabled: true,
  volume: 0.5,
  toggleSound: () => {},
  setVolume: () => {},
  playSound: () => {},
});

// MODERN SOFT SOUND - Smooth sine/triangle based sounds
function createSoftTone(
  ctx: AudioContext,
  freq: number,
  type: OscillatorType,
  duration: number,
  volume: number,
  delay: number = 0
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.type = type;
  osc.frequency.value = freq;

  const now = ctx.currentTime + delay;

  // Smooth envelope - soft attack, natural decay
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + 0.015); // Soft attack
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration); // Natural decay

  osc.start(now);
  osc.stop(now + duration + 0.05);
}

// PLUCK SOUND - Short satisfying click/pop
function createPluck(
  ctx: AudioContext,
  freq: number,
  volume: number,
  delay: number = 0
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  osc.type = "sine";
  osc.frequency.value = freq;

  filter.type = "lowpass";
  filter.frequency.value = 2000;
  filter.Q.value = 1;

  const now = ctx.currentTime + delay;

  // Very short pluck
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

  // Frequency sweep down for "pop" feel
  osc.frequency.setValueAtTime(freq * 1.5, now);
  osc.frequency.exponentialRampToValueAtTime(freq, now + 0.02);

  osc.start(now);
  osc.stop(now + 0.1);
}

// SHIMMER - Sparkling high-frequency effect
function createShimmer(
  ctx: AudioContext,
  baseFreq: number,
  volume: number,
  delay: number = 0
) {
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();

  osc1.connect(gain);
  osc2.connect(gain);
  gain.connect(ctx.destination);

  osc1.type = "sine";
  osc2.type = "triangle";
  osc1.frequency.value = baseFreq;
  osc2.frequency.value = baseFreq * 1.5;

  const now = ctx.currentTime + delay;

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume * 0.5, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

  osc1.start(now);
  osc2.start(now);
  osc1.stop(now + 0.2);
  osc2.stop(now + 0.2);
}

export function SoundManagerProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(true);
  const [volume, setVolume] = useState(0.5);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Initialize audio context on first user interaction
  const initAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    if (audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  // Load preference from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("taptrader-sound-enabled");
    if (saved !== null) {
      setEnabled(saved === "true");
    }
    const savedVolume = localStorage.getItem("taptrader-sound-volume");
    if (savedVolume !== null) {
      setVolume(parseFloat(savedVolume));
    }
  }, []);

  const toggleSound = useCallback(() => {
    setEnabled((prev) => {
      const newValue = !prev;
      localStorage.setItem("taptrader-sound-enabled", String(newValue));
      return newValue;
    });
  }, []);

  const handleSetVolume = useCallback((newVolume: number) => {
    setVolume(newVolume);
    localStorage.setItem("taptrader-sound-volume", String(newVolume));
  }, []);

  const playSound = useCallback(
    (type: SoundType) => {
      if (!enabled) return;

      const ctx = initAudioContext();
      const vol = volume * 0.25; // Keep sounds subtle

      switch (type) {
        case "tap":
          // Soft pop/click - very subtle
          createPluck(ctx, 800, vol * 0.4);
          break;

        case "bet":
          // Confirmation - two soft tones rising
          createPluck(ctx, 600, vol * 0.5);
          createPluck(ctx, 900, vol * 0.6, 0.08);
          break;

        case "win":
          // Pleasant ascending chime
          createShimmer(ctx, 880, vol);
          createShimmer(ctx, 1100, vol * 0.8, 0.1);
          createShimmer(ctx, 1320, vol * 0.6, 0.2);
          break;

        case "loss":
          // Soft descending tone - not harsh
          createSoftTone(ctx, 400, "sine", 0.2, vol * 0.5);
          createSoftTone(ctx, 300, "sine", 0.25, vol * 0.4, 0.1);
          break;

        case "bigWin":
          // Celebratory shimmer cascade
          const winFreqs = [880, 1100, 1320, 1540, 1760];
          winFreqs.forEach((freq, i) => {
            createShimmer(ctx, freq, vol * 0.7, i * 0.08);
          });
          // Final sparkle
          setTimeout(() => {
            createShimmer(ctx, 1760, vol * 0.5);
            createShimmer(ctx, 2200, vol * 0.4, 0.05);
          }, 400);
          break;

        case "streak":
          // Quick ascending sparkles
          [660, 880, 1100, 1320].forEach((freq, i) => {
            createShimmer(ctx, freq, vol * 0.5, i * 0.06);
          });
          break;

        case "levelUp":
          // Triumphant but soft
          createSoftTone(ctx, 523, "triangle", 0.2, vol * 0.6);
          createSoftTone(ctx, 659, "triangle", 0.2, vol * 0.5, 0.15);
          createSoftTone(ctx, 784, "triangle", 0.3, vol * 0.6, 0.3);
          break;

        case "achievement":
          // Gentle sparkle
          [1200, 1500, 1800].forEach((freq, i) => {
            createShimmer(ctx, freq, vol * 0.4, i * 0.07);
          });
          break;

        case "error":
          // Soft low thud - not harsh buzzer
          createSoftTone(ctx, 200, "sine", 0.15, vol * 0.4);
          createSoftTone(ctx, 150, "sine", 0.1, vol * 0.3, 0.08);
          break;

        case "countdown":
          // Subtle tick
          createPluck(ctx, 1000, vol * 0.3);
          break;
      }
    },
    [enabled, volume, initAudioContext]
  );

  return (
    <SoundManagerContext.Provider
      value={{ enabled, volume, toggleSound, setVolume: handleSetVolume, playSound }}
    >
      {children}
    </SoundManagerContext.Provider>
  );
}

export function useSoundManager() {
  return useContext(SoundManagerContext);
}

// =============================================================================
// SOUND TOGGLE BUTTON - TAPTRADER THEME
// =============================================================================

interface SoundToggleProps {
  className?: string;
  showLabel?: boolean;
}

export function SoundToggle({ className = "", showLabel = false }: SoundToggleProps) {
  const { enabled, toggleSound } = useSoundManager();

  return (
    <motion.button
      whileTap={{ scale: 0.9 }}
      onClick={toggleSound}
      className={`
        flex items-center gap-2 p-2 font-mono text-xs
        ${enabled
          ? "bg-neon/10 text-neon border border-neon/30"
          : "bg-background-card text-text-muted border border-border"
        }
        transition-all hover:border-neon/50
        ${className}
      `}
      style={enabled ? { boxShadow: '0 0 10px rgba(0, 255, 65, 0.2)' } : {}}
    >
      {enabled ? (
        <Volume2 className="w-4 h-4" />
      ) : (
        <VolumeX className="w-4 h-4" />
      )}
      {showLabel && (
        <span className="font-bold uppercase tracking-wider">
          {enabled ? "SFX_ON" : "SFX_OFF"}
        </span>
      )}
    </motion.button>
  );
}

// =============================================================================
// VOLUME SLIDER - TAPTRADER THEME
// =============================================================================

interface VolumeSliderProps {
  className?: string;
}

export function VolumeSlider({ className = "" }: VolumeSliderProps) {
  const { volume, setVolume, enabled } = useSoundManager();

  return (
    <div className={`flex items-center gap-2 font-mono ${className}`}>
      <VolumeX className={`w-4 h-4 ${enabled ? "text-neon/50" : "text-text-muted"}`} />
      <input
        type="range"
        min="0"
        max="1"
        step="0.1"
        value={volume}
        onChange={(e) => setVolume(parseFloat(e.target.value))}
        disabled={!enabled}
        className="w-20 h-1 appearance-none bg-background-card cursor-pointer disabled:opacity-50"
        style={{
          background: `linear-gradient(to right,
            #00ff41 0%,
            #00ff41 ${volume * 100}%,
            #1a1a1a ${volume * 100}%,
            #1a1a1a 100%)`,
        }}
      />
      <Volume2 className={`w-4 h-4 ${enabled ? "text-neon" : "text-text-muted"}`} />
      <span className={`text-xs ${enabled ? "text-neon" : "text-text-muted"}`}>
        {Math.round(volume * 100)}%
      </span>
    </div>
  );
}
