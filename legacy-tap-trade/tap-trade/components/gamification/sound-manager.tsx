"use client";

import { createContext, useContext, useCallback, useState, useEffect, useRef, ReactNode } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { motion } from "framer-motion";

// =============================================================================
// SOUND MANAGER - Game Sound Effects with Toggle
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

// Web Audio API based sound generator
function createOscillatorSound(
  audioContext: AudioContext,
  frequency: number,
  type: OscillatorType,
  duration: number,
  volume: number,
  envelope?: { attack: number; decay: number; sustain: number; release: number }
) {
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  oscillator.type = type;
  oscillator.frequency.value = frequency;

  const now = audioContext.currentTime;

  if (envelope) {
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(volume, now + envelope.attack);
    gainNode.gain.linearRampToValueAtTime(volume * envelope.sustain, now + envelope.attack + envelope.decay);
    gainNode.gain.linearRampToValueAtTime(0, now + duration);
  } else {
    gainNode.gain.setValueAtTime(volume, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);
  }

  oscillator.start(now);
  oscillator.stop(now + duration);
}

function playChord(
  audioContext: AudioContext,
  frequencies: number[],
  type: OscillatorType,
  duration: number,
  volume: number
) {
  frequencies.forEach((freq, i) => {
    setTimeout(() => {
      createOscillatorSound(audioContext, freq, type, duration, volume * 0.7);
    }, i * 50);
  });
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
    const saved = localStorage.getItem("soundEnabled");
    if (saved !== null) {
      setEnabled(saved === "true");
    }
    const savedVolume = localStorage.getItem("soundVolume");
    if (savedVolume !== null) {
      setVolume(parseFloat(savedVolume));
    }
  }, []);

  const toggleSound = useCallback(() => {
    setEnabled((prev) => {
      const newValue = !prev;
      localStorage.setItem("soundEnabled", String(newValue));
      return newValue;
    });
  }, []);

  const handleSetVolume = useCallback((newVolume: number) => {
    setVolume(newVolume);
    localStorage.setItem("soundVolume", String(newVolume));
  }, []);

  const playSound = useCallback(
    (type: SoundType) => {
      if (!enabled) return;

      const ctx = initAudioContext();
      const vol = volume;

      switch (type) {
        case "tap":
          createOscillatorSound(ctx, 800, "sine", 0.05, vol * 0.3);
          break;

        case "bet":
          createOscillatorSound(ctx, 440, "sine", 0.1, vol * 0.4);
          setTimeout(() => createOscillatorSound(ctx, 554, "sine", 0.1, vol * 0.3), 50);
          break;

        case "win":
          playChord(ctx, [523, 659, 784], "sine", 0.3, vol * 0.5);
          break;

        case "loss":
          createOscillatorSound(ctx, 200, "sawtooth", 0.2, vol * 0.3, {
            attack: 0.01,
            decay: 0.05,
            sustain: 0.5,
            release: 0.1,
          });
          break;

        case "bigWin":
          // Fanfare-like sound
          [523, 659, 784, 1047].forEach((freq, i) => {
            setTimeout(() => {
              createOscillatorSound(ctx, freq, "sine", 0.4, vol * 0.5);
              createOscillatorSound(ctx, freq * 1.5, "triangle", 0.3, vol * 0.3);
            }, i * 100);
          });
          break;

        case "streak":
          // Rising arpeggio
          [330, 392, 494, 587, 659].forEach((freq, i) => {
            setTimeout(() => {
              createOscillatorSound(ctx, freq, "sine", 0.15, vol * 0.4);
            }, i * 60);
          });
          break;

        case "levelUp":
          // Triumphant chord progression
          setTimeout(() => playChord(ctx, [262, 330, 392], "sine", 0.4, vol * 0.4), 0);
          setTimeout(() => playChord(ctx, [294, 370, 440], "sine", 0.4, vol * 0.4), 300);
          setTimeout(() => playChord(ctx, [330, 415, 494, 659], "sine", 0.6, vol * 0.5), 600);
          break;

        case "achievement":
          // Sparkle sound
          [880, 1175, 1397, 1760].forEach((freq, i) => {
            setTimeout(() => {
              createOscillatorSound(ctx, freq, "sine", 0.2, vol * 0.3);
            }, i * 80);
          });
          break;

        case "error":
          createOscillatorSound(ctx, 200, "square", 0.15, vol * 0.3);
          setTimeout(() => createOscillatorSound(ctx, 150, "square", 0.2, vol * 0.3), 100);
          break;

        case "countdown":
          createOscillatorSound(ctx, 440, "sine", 0.08, vol * 0.4);
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
// SOUND TOGGLE BUTTON - Visual toggle for sound on/off
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
        flex items-center gap-2 p-2 rounded-lg
        ${enabled
          ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
          : "bg-gray-800 text-gray-500 border border-gray-700"
        }
        transition-all hover:bg-opacity-80
        ${className}
      `}
    >
      {enabled ? (
        <Volume2 className="w-5 h-5" />
      ) : (
        <VolumeX className="w-5 h-5" />
      )}
      {showLabel && (
        <span className="text-sm font-medium">
          {enabled ? "Sound On" : "Sound Off"}
        </span>
      )}
    </motion.button>
  );
}

// =============================================================================
// VOLUME SLIDER - Volume control slider
// =============================================================================

interface VolumeSliderProps {
  className?: string;
}

export function VolumeSlider({ className = "" }: VolumeSliderProps) {
  const { volume, setVolume, enabled } = useSoundManager();

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <VolumeX className={`w-4 h-4 ${enabled ? "text-gray-400" : "text-gray-600"}`} />
      <input
        type="range"
        min="0"
        max="1"
        step="0.1"
        value={volume}
        onChange={(e) => setVolume(parseFloat(e.target.value))}
        disabled={!enabled}
        className="w-20 h-2 appearance-none bg-gray-700 rounded-full cursor-pointer disabled:opacity-50"
        style={{
          background: `linear-gradient(to right,
            rgb(168, 85, 247) 0%,
            rgb(168, 85, 247) ${volume * 100}%,
            rgb(55, 65, 81) ${volume * 100}%,
            rgb(55, 65, 81) 100%)`,
        }}
      />
      <Volume2 className={`w-4 h-4 ${enabled ? "text-gray-400" : "text-gray-600"}`} />
    </div>
  );
}
