"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Flame } from "lucide-react";
import { useGamification } from "@/stores";

// =============================================================================
// STREAK DISPLAY - Enhanced Animated Streak Counter with Fire Effects
// =============================================================================

// Streak multiplier calculation
function getStreakMultiplier(streak: number): number {
  if (streak < 2) return 1;
  if (streak === 2) return 1.1;
  if (streak === 3) return 1.2;
  if (streak === 4) return 1.3;
  if (streak === 5) return 1.5;
  if (streak < 10) return 1.5 + (streak - 5) * 0.1;
  return 2.0;
}

interface StreakDisplayProps {
  size?: "xs" | "sm" | "md" | "lg";
  streak?: number; // Optional override for the streak value
  showMultiplier?: boolean;
  className?: string;
}

export function StreakDisplay({
  size = "md",
  streak: propStreak,
  showMultiplier = true,
  className = "",
}: StreakDisplayProps) {
  const { currentStreak, maxStreak } = useGamification();
  const streak = propStreak ?? currentStreak;

  const sizeClasses = {
    xs: "px-1.5 py-0.5 gap-0.5",
    sm: "px-2 py-1 gap-1",
    md: "px-3 py-1.5 gap-2",
    lg: "px-4 py-2 gap-2",
  };

  const iconSizes = {
    xs: "w-3 h-3",
    sm: "w-4 h-4",
    md: "w-5 h-5",
    lg: "w-6 h-6",
  };

  const textSizes = {
    xs: "text-xs",
    sm: "text-sm",
    md: "text-base",
    lg: "text-lg",
  };

  const isOnFire = streak >= 3;
  const isSuperHot = streak >= 5;
  const isUltra = streak >= 10;
  const multiplier = getStreakMultiplier(streak);

  // Show placeholder when no streak
  if (streak === 0) {
    return (
      <div className={`glass rounded-2xl ${sizeClasses[size]} flex items-center ${className}`}>
        <Flame className={`${iconSizes[size]} text-text-muted`} />
        <span className={`font-bold text-text-muted ${textSizes[size]}`}>0</span>
      </div>
    );
  }

  const getGradient = () => {
    if (isUltra) return "from-purple-500/30 via-pink-500/30 to-red-500/30";
    if (isSuperHot) return "from-yellow-400/30 via-orange-500/30 to-red-500/30";
    if (isOnFire) return "from-yellow-500/30 to-orange-500/30";
    return "from-accent-orange/20 to-accent-yellow/20";
  };

  const getGlow = () => {
    if (isUltra) return "shadow-[0_0_20px_rgba(168,85,247,0.5)]";
    if (isSuperHot) return "shadow-[0_0_15px_rgba(249,115,22,0.4)]";
    if (isOnFire) return "shadow-[0_0_10px_rgba(251,191,36,0.3)]";
    return "";
  };

  const getFlameColor = () => {
    if (isUltra) return "text-purple-400";
    if (isSuperHot) return "text-orange-400";
    return "text-accent-orange";
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        className={`
          glass rounded-2xl ${sizeClasses[size]} flex items-center
          bg-gradient-to-r ${getGradient()} ${getGlow()}
          ${className}
        `}
      >
        {/* Animated Fire Icon */}
        <motion.div
          animate={{
            scale: isOnFire ? [1, 1.3, 1] : [1, 1.1, 1],
            rotate: isOnFire ? [0, -5, 5, 0] : 0,
          }}
          transition={{
            repeat: Infinity,
            duration: isOnFire ? 0.4 : 0.6,
          }}
          className="relative"
        >
          <Flame className={`${iconSizes[size]} ${getFlameColor()}`} />

          {/* Extra flames for hot streaks */}
          {isSuperHot && (
            <>
              <motion.div
                className="absolute -top-1 -left-1"
                animate={{ opacity: [0.5, 1, 0.5], y: [-2, -6, -2] }}
                transition={{ duration: 0.3, repeat: Infinity }}
              >
                <Flame className="w-3 h-3 text-yellow-400" />
              </motion.div>
              <motion.div
                className="absolute -top-1 -right-1"
                animate={{ opacity: [0.5, 1, 0.5], y: [-2, -6, -2] }}
                transition={{ duration: 0.3, repeat: Infinity, delay: 0.15 }}
              >
                <Flame className="w-3 h-3 text-red-400" />
              </motion.div>
            </>
          )}

          {/* Fire particles */}
          {isOnFire && (
            <div className="absolute inset-0 overflow-visible">
              {[...Array(isUltra ? 6 : isSuperHot ? 4 : 2)].map((_, i) => (
                <motion.div
                  key={i}
                  className="absolute w-1.5 h-1.5 rounded-full"
                  style={{
                    background: isUltra
                      ? `hsl(${280 + i * 25}, 100%, 60%)`
                      : `hsl(${30 + i * 15}, 100%, 50%)`,
                    left: `${30 + i * 10}%`,
                  }}
                  animate={{
                    y: [0, -15 - Math.random() * 10],
                    x: [(Math.random() - 0.5) * 5, (Math.random() - 0.5) * 10],
                    opacity: [0.8, 0],
                    scale: [1, 0.3],
                  }}
                  transition={{
                    duration: 0.5 + Math.random() * 0.3,
                    repeat: Infinity,
                    delay: i * 0.08,
                  }}
                />
              ))}
            </div>
          )}
        </motion.div>

        {/* Streak Count */}
        <motion.span
          className={`font-bold ${getFlameColor()} ${textSizes[size]}`}
          key={streak}
          initial={{ scale: 1.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
        >
          {streak}
        </motion.span>

        {/* Best indicator */}
        {streak >= maxStreak && streak > 1 && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="text-xs text-accent-yellow font-bold"
          >
            BEST!
          </motion.span>
        )}

        {/* Multiplier Badge */}
        {showMultiplier && streak >= 2 && (
          <motion.div
            initial={{ x: -5, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            className="ml-1 px-1.5 py-0.5 rounded text-xs font-bold bg-black/40 text-yellow-400 border border-yellow-500/30"
          >
            {multiplier.toFixed(1)}x
          </motion.div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

// =============================================================================
// STREAK POPUP - Appears when streak milestones are hit
// =============================================================================

interface StreakPopupProps {
  streak: number;
  show: boolean;
  onComplete?: () => void;
}

export function StreakPopup({ streak, show, onComplete }: StreakPopupProps) {
  const getMessage = () => {
    if (streak === 3) return { text: "ON FIRE!", color: "from-yellow-400 to-orange-500" };
    if (streak === 5) return { text: "UNSTOPPABLE!", color: "from-orange-400 to-red-500" };
    if (streak === 10) return { text: "LEGENDARY!", color: "from-purple-400 to-pink-500" };
    if (streak === 15) return { text: "GODLIKE!", color: "from-cyan-400 to-purple-500" };
    if (streak === 20) return { text: "TRANSCENDENT!", color: "from-white to-yellow-400" };
    return null;
  };

  const message = getMessage();

  return (
    <AnimatePresence>
      {show && message && (
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 2, opacity: 0 }}
          onAnimationComplete={() => {
            if (onComplete) setTimeout(onComplete, 1500);
          }}
          className="fixed inset-0 flex items-center justify-center pointer-events-none z-50"
        >
          <motion.div
            animate={{
              scale: [1, 1.2, 1],
              rotate: [0, -3, 3, 0],
            }}
            transition={{
              duration: 0.5,
              repeat: 2,
            }}
            className="text-center"
          >
            <motion.div
              className="flex justify-center gap-2 text-5xl mb-2"
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 0.3, repeat: 3 }}
            >
              <Flame className="w-12 h-12 text-orange-400" />
              <Flame className="w-16 h-16 text-yellow-400" />
              <Flame className="w-12 h-12 text-orange-400" />
            </motion.div>
            <motion.div
              className={`
                text-4xl font-black tracking-wider
                bg-gradient-to-r ${message.color}
                bg-clip-text text-transparent
                drop-shadow-[0_0_30px_rgba(251,191,36,0.8)]
              `}
            >
              {message.text}
            </motion.div>
            <motion.div
              className="text-xl font-bold text-yellow-400 mt-2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              {streak}x WIN STREAK
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
