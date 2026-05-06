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

// NEON TAP - short, tactile coin-like UI click.
function createNeonTap(ctx: AudioContext, volume: number) {
  const now = ctx.currentTime;
  const output = ctx.createGain();
  const filter = ctx.createBiquadFilter();

  filter.type = "bandpass";
  filter.frequency.setValueAtTime(1150, now);
  filter.frequency.exponentialRampToValueAtTime(1850, now + 0.05);
  filter.Q.value = 3.6;

  output.gain.setValueAtTime(0, now);
  output.gain.linearRampToValueAtTime(volume * 0.95, now + 0.006);
  output.gain.exponentialRampToValueAtTime(0.001, now + 0.13);

  filter.connect(output);
  output.connect(ctx.destination);

  const body = ctx.createOscillator();
  body.type = "triangle";
  body.frequency.setValueAtTime(620, now);
  body.frequency.exponentialRampToValueAtTime(410, now + 0.075);
  body.connect(filter);
  body.start(now);
  body.stop(now + 0.14);

  const shine = ctx.createOscillator();
  shine.type = "sine";
  shine.frequency.setValueAtTime(1380, now + 0.012);
  shine.frequency.exponentialRampToValueAtTime(1850, now + 0.08);
  shine.connect(filter);
  shine.start(now + 0.012);
  shine.stop(now + 0.12);
}

function createWinChime(ctx: AudioContext, volume: number) {
  // Three-stage sound for visceral payoff feel:
  //   1. Bright impact "ding" at t=0 — communicates "you hit"
  //   2. Ascending major-7 arpeggio (C-E-G-B) — climbing satisfaction
  //   3. Sparkle tail at +250 ms — echoes the win
  // Tuned louder and richer than the previous gentle 4-tone chime
  // because players reported wins feeling underwhelming.

  // 1. Impact ding — bell-like sine at high freq with quick decay
  const ding = ctx.createOscillator();
  const dingGain = ctx.createGain();
  ding.type = "sine";
  ding.frequency.setValueAtTime(2093, ctx.currentTime);  // C7
  dingGain.gain.setValueAtTime(volume * 0.65, ctx.currentTime);
  dingGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
  ding.connect(dingGain);
  dingGain.connect(ctx.destination);
  ding.start(ctx.currentTime);
  ding.stop(ctx.currentTime + 0.2);

  // 2. Major-7 arpeggio — C5, E5, G5, B5
  const arpFreqs = [523.25, 659.25, 783.99, 987.77];
  arpFreqs.forEach((freq, i) => {
    createSoftTone(ctx, freq, "triangle", 0.22, volume * (0.78 - i * 0.06), 0.04 + i * 0.06);
    // Octave-up shimmer for sparkle
    createShimmer(ctx, freq * 2, volume * (0.55 - i * 0.06), 0.04 + i * 0.06 + 0.02);
  });

  // 3. Tail sparkle — final cascade after the arpeggio resolves
  setTimeout(() => {
    createShimmer(ctx, 2637, volume * 0.4); // E7
    createShimmer(ctx, 3136, volume * 0.32, 0.04); // G7
  }, 280);
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
    // ALWAYS warm up the AudioContext inside this user-gesture handler,
    // regardless of which way the toggle is going. Default state is
    // enabled=true, so the first click toggles OFF (newValue=false) —
    // if we only init on the ON branch, the very first user click
    // burns the only reliable user-gesture moment without warming
    // the audio pipeline. Subsequent attempts may fail silently in
    // Chrome / Safari / mobile WebKit.
    try {
      const ctx = (audioContextRef.current ??=
        new (window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext)());
      if (ctx.state === "suspended") {
        // Resume returns a Promise — fire-and-forget is fine; the
        // context will be running by the time the user clicks a
        // cell or a bet resolves.
        void ctx.resume();
      }
    } catch {
      // No audio API in this environment.
    }

    setEnabled((prev) => {
      const newValue = !prev;
      localStorage.setItem("taptrader-sound-enabled", String(newValue));
      // Confirmation tone only when toggling ON, so the user can
      // hear that audio is alive. OFF→silence (don't fight the
      // user's intent).
      if (newValue && audioContextRef.current) {
        try {
          createNeonTap(audioContextRef.current, 0.45);
        } catch {
          // ignore
        }
      }
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
      const vol = volume * 0.34; // Present, but still short and UI-safe.

      // If the context is still suspended (Chrome / Safari pre-gesture
      // state, or just after creation), we'd schedule oscillators in
      // a paused timeline and they'd never play. Defer the actual
      // sound construction until resume() resolves — synchronous code
      // returns immediately and the user hears the sound a few ms
      // later, which is imperceptible.
      if (ctx.state === "suspended") {
        void ctx.resume().then(() => playInternal(type, ctx, vol));
        return;
      }

      playInternal(type, ctx, vol);
    },
    [enabled, volume, initAudioContext]
  );

  function playInternal(type: SoundType, ctx: AudioContext, vol: number) {
      switch (type) {
        case "tap":
          createNeonTap(ctx, vol);
          break;

        case "bet":
          createPluck(ctx, 720, vol * 0.42);
          createPluck(ctx, 1080, vol * 0.36, 0.055);
          break;

        case "win":
          createWinChime(ctx, vol);
          break;

        case "loss":
          // TapTrading intentionally keeps losses silent.
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
  }

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
