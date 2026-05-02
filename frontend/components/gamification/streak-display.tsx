"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Flame } from "lucide-react";
import { useGamification } from "@/stores";

// =============================================================================
// STREAK DISPLAY - Animated Streak Counter
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
  streak?: number;
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
      <div className={`bg-background-card border border-border rounded ${sizeClasses[size]} flex items-center ${className}`}>
        <Flame className={`${iconSizes[size]} text-text-muted`} />
        <span className={`font-mono font-bold text-text-muted ${textSizes[size]}`}>0</span>
      </div>
    );
  }

  // All gradients use neon green
  const getGradient = () => {
    if (isUltra) return "from-neon-500/40 via-neon-400/30 to-neon-600/40";
    if (isSuperHot) return "from-neon-500/30 via-neon-400/25 to-neon-300/30";
    if (isOnFire) return "from-neon-500/25 to-neon-600/25";
    return "from-neon-500/15 to-neon-600/15";
  };

  const getGlow = () => {
    if (isUltra) return "shadow-neon-lg";
    if (isSuperHot) return "shadow-neon";
    if (isOnFire) return "shadow-neon-sm";
    return "";
  };

  const getFlameColor = () => {
    if (isUltra) return "text-neon-300";
    if (isSuperHot) return "text-neon-400";
    return "text-neon-500";
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        className={`
          bg-background-card border border-border-neon rounded ${sizeClasses[size]} flex items-center
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

          {/* Extra flames for hot streaks - neon green */}
          {isSuperHot && (
            <>
              <motion.div
                className="absolute -top-1 -left-1"
                animate={{ opacity: [0.5, 1, 0.5], y: [-2, -6, -2] }}
                transition={{ duration: 0.3, repeat: Infinity }}
              >
                <Flame className="w-3 h-3 text-neon-400" />
              </motion.div>
              <motion.div
                className="absolute -top-1 -right-1"
                animate={{ opacity: [0.5, 1, 0.5], y: [-2, -6, -2] }}
                transition={{ duration: 0.3, repeat: Infinity, delay: 0.15 }}
              >
                <Flame className="w-3 h-3 text-neon-300" />
              </motion.div>
            </>
          )}

          {/* Fire particles - neon green */}
          {isOnFire && (
            <div className="absolute inset-0 overflow-visible">
              {[...Array(isUltra ? 6 : isSuperHot ? 4 : 2)].map((_, i) => (
                <motion.div
                  key={i}
                  className="absolute w-1.5 h-1.5 rounded-full bg-neon"
                  style={{
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
          className={`font-mono font-bold ${getFlameColor()} ${textSizes[size]}`}
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
            className="text-xs text-neon font-mono font-bold"
          >
            BEST!
          </motion.span>
        )}

        {/* Multiplier Badge */}
        {showMultiplier && streak >= 2 && (
          <motion.div
            initial={{ x: -5, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            className="ml-1 px-1.5 py-0.5 rounded text-xs font-mono font-bold bg-neon-muted text-neon border border-border-neon"
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
    // All green gradients
    if (streak === 3) return { text: "ON FIRE!", color: "from-neon-500 to-neon-400" };
    if (streak === 5) return { text: "UNSTOPPABLE!", color: "from-neon-400 to-neon-300" };
    if (streak === 10) return { text: "LEGENDARY!", color: "from-neon-300 to-neon-200" };
    if (streak === 15) return { text: "GODLIKE!", color: "from-neon-200 to-white" };
    if (streak === 20) return { text: "TRANSCENDENT!", color: "from-white to-neon-100" };
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
              <Flame className="w-12 h-12 text-neon-400" />
              <Flame className="w-16 h-16 text-neon" />
              <Flame className="w-12 h-12 text-neon-400" />
            </motion.div>
            <motion.div
              className={`
                text-4xl font-mono font-black tracking-wider uppercase
                bg-gradient-to-r ${message.color}
                bg-clip-text text-transparent
                drop-shadow-[0_0_30px_rgba(0,255,65,0.8)]
              `}
            >
              {message.text}
            </motion.div>
            <motion.div
              className="text-xl font-mono font-bold text-neon mt-2"
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
