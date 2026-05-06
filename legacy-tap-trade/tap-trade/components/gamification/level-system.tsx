"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Star, Zap, Trophy, Crown, Sparkles } from "lucide-react";
import { LEVEL_THRESHOLDS } from "@/types/gamification";

// =============================================================================
// LEVEL SYSTEM - XP Progress Bar with Animated Level Display
// =============================================================================

interface LevelDisplayProps {
  level: number;
  currentXP: number;
  totalXP: number;
  className?: string;
  compact?: boolean;
}

export function getLevelFromXP(totalXP: number): { level: number; currentXP: number; xpToNextLevel: number; title: string } {
  let level = 1;
  let xpForCurrentLevel = 0;
  let xpForNextLevel = LEVEL_THRESHOLDS[1]?.xp ?? 100;

  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (totalXP >= LEVEL_THRESHOLDS[i].xp) {
      level = LEVEL_THRESHOLDS[i].level;
      xpForCurrentLevel = LEVEL_THRESHOLDS[i].xp;
      xpForNextLevel = LEVEL_THRESHOLDS[i + 1]?.xp ?? LEVEL_THRESHOLDS[i].xp + 1000;
      break;
    }
  }

  const title = LEVEL_THRESHOLDS.find(t => t.level === level)?.title ?? "Trader";

  return {
    level,
    currentXP: totalXP - xpForCurrentLevel,
    xpToNextLevel: xpForNextLevel - xpForCurrentLevel,
    title,
  };
}

export function LevelDisplay({ level, currentXP, totalXP, className = "", compact = false }: LevelDisplayProps) {
  const levelData = getLevelFromXP(totalXP);
  const progress = levelData.xpToNextLevel > 0 ? (levelData.currentXP / levelData.xpToNextLevel) * 100 : 100;

  const getLevelIcon = () => {
    if (level >= 12) return <Crown className="w-4 h-4" />;
    if (level >= 8) return <Trophy className="w-4 h-4" />;
    if (level >= 5) return <Star className="w-4 h-4" />;
    return <Zap className="w-4 h-4" />;
  };

  const getLevelColor = () => {
    if (level >= 12) return "from-yellow-400 via-amber-500 to-orange-500";
    if (level >= 8) return "from-purple-400 via-pink-500 to-red-500";
    if (level >= 5) return "from-cyan-400 via-blue-500 to-purple-500";
    return "from-green-400 via-emerald-500 to-teal-500";
  };

  const getGlowColor = () => {
    if (level >= 12) return "rgba(251, 191, 36, 0.4)";
    if (level >= 8) return "rgba(168, 85, 247, 0.4)";
    if (level >= 5) return "rgba(6, 182, 212, 0.4)";
    return "rgba(34, 197, 94, 0.4)";
  };

  if (compact) {
    return (
      <motion.div
        className={`flex items-center gap-2 ${className}`}
        whileHover={{ scale: 1.02 }}
      >
        {/* Level Badge */}
        <motion.div
          className={`
            relative flex items-center justify-center w-8 h-8 rounded-lg
            bg-gradient-to-br ${getLevelColor()}
          `}
          style={{
            boxShadow: `0 0 15px ${getGlowColor()}`,
          }}
        >
          <span className="text-white font-bold text-sm">{level}</span>
          {/* Sparkle effect */}
          <motion.div
            className="absolute -top-1 -right-1"
            animate={{ rotate: [0, 180, 360], scale: [0.8, 1, 0.8] }}
            transition={{ duration: 3, repeat: Infinity }}
          >
            <Sparkles className="w-3 h-3 text-yellow-300" />
          </motion.div>
        </motion.div>

        {/* Mini progress bar */}
        <div className="flex-1">
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <motion.div
              className={`h-full bg-gradient-to-r ${getLevelColor()}`}
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className={`p-3 rounded-xl bg-black/30 border border-gray-800 ${className}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex items-center justify-between mb-2">
        {/* Level badge with icon */}
        <div className="flex items-center gap-2">
          <motion.div
            className={`
              relative flex items-center justify-center w-10 h-10 rounded-xl
              bg-gradient-to-br ${getLevelColor()}
            `}
            style={{
              boxShadow: `0 0 20px ${getGlowColor()}`,
            }}
            animate={{
              boxShadow: [
                `0 0 15px ${getGlowColor()}`,
                `0 0 25px ${getGlowColor()}`,
                `0 0 15px ${getGlowColor()}`,
              ],
            }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <span className="text-white font-bold">{level}</span>
            {getLevelIcon()}
          </motion.div>

          <div>
            <p className="text-sm font-bold text-white">{levelData.title}</p>
            <p className="text-xs text-gray-400">Level {level}</p>
          </div>
        </div>

        {/* XP count */}
        <div className="text-right">
          <p className="text-sm font-bold text-white">{levelData.currentXP} XP</p>
          <p className="text-xs text-gray-400">/ {levelData.xpToNextLevel} XP</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="relative h-3 bg-gray-800 rounded-full overflow-hidden">
        <motion.div
          className={`absolute inset-y-0 left-0 bg-gradient-to-r ${getLevelColor()}`}
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />

        {/* Shimmer effect */}
        <motion.div
          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent"
          animate={{ x: ["-100%", "100%"] }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
        />
      </div>

      {/* Next level hint */}
      <p className="text-xs text-gray-500 mt-1 text-center">
        {levelData.xpToNextLevel - levelData.currentXP} XP to Level {level + 1}
      </p>
    </motion.div>
  );
}

// =============================================================================
// LEVEL UP POPUP - Celebration when leveling up
// =============================================================================

interface LevelUpPopupProps {
  newLevel: number;
  show: boolean;
  onComplete?: () => void;
}

export function LevelUpPopup({ newLevel, show, onComplete }: LevelUpPopupProps) {
  const levelData = LEVEL_THRESHOLDS.find(t => t.level === newLevel);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onAnimationComplete={() => {
            if (onComplete) setTimeout(onComplete, 2500);
          }}
          className="fixed inset-0 flex items-center justify-center pointer-events-none z-50 bg-black/50"
        >
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 0, rotate: 180 }}
            transition={{ type: "spring", damping: 15 }}
            className="text-center"
          >
            {/* Level badge */}
            <motion.div
              className="relative inline-flex items-center justify-center w-32 h-32 mb-4"
              animate={{
                boxShadow: [
                  "0 0 30px rgba(168, 85, 247, 0.5)",
                  "0 0 60px rgba(168, 85, 247, 0.8)",
                  "0 0 30px rgba(168, 85, 247, 0.5)",
                ],
              }}
              transition={{ duration: 1, repeat: Infinity }}
            >
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-purple-400 via-pink-500 to-orange-400 animate-spin-slow" />
              <div className="absolute inset-2 rounded-full bg-gray-900 flex items-center justify-center">
                <span className="text-5xl font-black text-white">{newLevel}</span>
              </div>

              {/* Orbiting particles */}
              {[...Array(8)].map((_, i) => (
                <motion.div
                  key={i}
                  className="absolute w-3 h-3 rounded-full bg-yellow-400"
                  style={{
                    boxShadow: "0 0 10px rgba(251, 191, 36, 0.8)",
                  }}
                  animate={{
                    rotate: [0, 360],
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: "linear",
                    delay: i * 0.25,
                  }}
                  initial={{
                    x: Math.cos((i / 8) * Math.PI * 2) * 80,
                    y: Math.sin((i / 8) * Math.PI * 2) * 80,
                  }}
                />
              ))}
            </motion.div>

            {/* Text */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              <h2 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-purple-400 to-pink-400">
                LEVEL UP!
              </h2>
              <p className="text-xl font-bold text-white mt-2">
                {levelData?.title ?? "Trader"}
              </p>
              <p className="text-sm text-gray-400 mt-1">
                You reached Level {newLevel}
              </p>
            </motion.div>

            {/* Rays */}
            {[...Array(12)].map((_, i) => (
              <motion.div
                key={i}
                className="absolute w-1 h-20 bg-gradient-to-t from-transparent to-yellow-400"
                style={{
                  left: "50%",
                  top: "50%",
                  transformOrigin: "bottom center",
                  rotate: `${(i / 12) * 360}deg`,
                }}
                initial={{ opacity: 0, scaleY: 0 }}
                animate={{ opacity: [0, 0.6, 0], scaleY: [0, 1, 0] }}
                transition={{
                  duration: 1.5,
                  delay: 0.5 + i * 0.05,
                  repeat: 2,
                }}
              />
            ))}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// =============================================================================
// XP GAIN POPUP - Shows XP earned from trades
// =============================================================================

interface XPGainProps {
  amount: number;
  x: number;
  y: number;
  show: boolean;
}

export function XPGainPopup({ amount, x, y, show }: XPGainProps) {
  if (!show || amount <= 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 0, scale: 0.5 }}
      animate={{ opacity: 1, y: -30, scale: 1 }}
      exit={{ opacity: 0, y: -60, scale: 0.8 }}
      className="fixed pointer-events-none z-50"
      style={{ left: x, top: y }}
    >
      <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-purple-500/80 text-white text-sm font-bold">
        <Zap className="w-3 h-3" />
        +{amount} XP
      </div>
    </motion.div>
  );
}
