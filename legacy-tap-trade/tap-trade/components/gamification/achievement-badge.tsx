"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Star, Lock, Trophy, Zap, Target, Flame, Crown, Diamond } from "lucide-react";
import { Achievement, ACHIEVEMENTS } from "@/types/gamification";

// =============================================================================
// ACHIEVEMENT BADGE - Single Achievement Display with Unlock Animation
// =============================================================================

interface AchievementBadgeProps {
  achievement: Achievement;
  size?: "sm" | "md" | "lg";
  showTooltip?: boolean;
  onUnlock?: () => void;
}

const RARITY_COLORS = {
  common: {
    bg: "from-gray-500 to-gray-600",
    border: "border-gray-400",
    text: "text-gray-300",
    glow: "rgba(156, 163, 175, 0.4)",
  },
  rare: {
    bg: "from-blue-500 to-blue-600",
    border: "border-blue-400",
    text: "text-blue-300",
    glow: "rgba(59, 130, 246, 0.5)",
  },
  epic: {
    bg: "from-purple-500 to-purple-600",
    border: "border-purple-400",
    text: "text-purple-300",
    glow: "rgba(168, 85, 247, 0.5)",
  },
  legendary: {
    bg: "from-yellow-400 via-orange-500 to-red-500",
    border: "border-yellow-400",
    text: "text-yellow-300",
    glow: "rgba(251, 191, 36, 0.6)",
  },
};

const ACHIEVEMENT_ICONS: Record<string, typeof Star> = {
  first_win: Star,
  streak_3: Flame,
  streak_5: Flame,
  streak_10: Flame,
  wins_10: Target,
  wins_50: Target,
  wins_100: Trophy,
  big_win: Zap,
  huge_win: Crown,
  comeback: Zap,
  high_roller: Diamond,
  risk_taker: Zap,
  sniper: Target,
};

export function AchievementBadge({
  achievement,
  size = "md",
  showTooltip = true,
}: AchievementBadgeProps) {
  const colors = RARITY_COLORS[achievement.rarity];
  const Icon = ACHIEVEMENT_ICONS[achievement.id] || Star;

  const sizeClasses = {
    sm: "w-10 h-10",
    md: "w-14 h-14",
    lg: "w-20 h-20",
  };

  const iconSizes = {
    sm: "w-4 h-4",
    md: "w-6 h-6",
    lg: "w-8 h-8",
  };

  return (
    <div className="relative group">
      <motion.div
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        className={`
          relative ${sizeClasses[size]} rounded-xl
          flex items-center justify-center
          ${achievement.unlocked
            ? `bg-gradient-to-br ${colors.bg} border-2 ${colors.border}`
            : "bg-gray-800 border-2 border-gray-700"
          }
          transition-all cursor-pointer
        `}
        style={{
          boxShadow: achievement.unlocked
            ? `0 0 20px ${colors.glow}`
            : "none",
        }}
      >
        {/* Icon */}
        {achievement.unlocked ? (
          <Icon className={`${iconSizes[size]} text-white`} />
        ) : (
          <Lock className={`${iconSizes[size]} text-gray-600`} />
        )}

        {/* Shimmer effect for unlocked */}
        {achievement.unlocked && (
          <motion.div
            className="absolute inset-0 rounded-xl overflow-hidden"
            animate={{
              background: [
                "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.1) 50%, transparent 100%)",
                "linear-gradient(90deg, transparent 100%, rgba(255,255,255,0.1) 100%, transparent 100%)",
              ],
            }}
            transition={{ duration: 2, repeat: Infinity }}
          />
        )}

        {/* Progress indicator for locked with progress */}
        {!achievement.unlocked && achievement.progress !== undefined && achievement.maxProgress !== undefined && (
          <div
            className="absolute bottom-0 left-0 right-0 h-1 bg-gray-700 rounded-b-xl overflow-hidden"
          >
            <motion.div
              className="h-full bg-purple-500"
              initial={{ width: 0 }}
              animate={{ width: `${(achievement.progress / achievement.maxProgress) * 100}%` }}
            />
          </div>
        )}
      </motion.div>

      {/* Tooltip */}
      {showTooltip && (
        <div className="
          absolute bottom-full left-1/2 -translate-x-1/2 mb-2
          opacity-0 group-hover:opacity-100
          pointer-events-none transition-opacity z-50
        ">
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-2 min-w-[150px] text-center shadow-lg">
            <p className={`font-bold text-sm ${colors.text}`}>{achievement.name}</p>
            <p className="text-xs text-gray-400 mt-0.5">{achievement.description}</p>
            {!achievement.unlocked && achievement.progress !== undefined && (
              <p className="text-xs text-gray-500 mt-1">
                Progress: {achievement.progress}/{achievement.maxProgress}
              </p>
            )}
            <div className="flex items-center justify-center gap-1 mt-1">
              <Zap className="w-3 h-3 text-purple-400" />
              <span className="text-xs text-purple-300">+{achievement.xpReward} XP</span>
            </div>
          </div>
          {/* Arrow */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-transparent border-t-gray-700" />
        </div>
      )}
    </div>
  );
}

// =============================================================================
// ACHIEVEMENT GRID - Display All Achievements
// =============================================================================

interface AchievementGridProps {
  achievements: Achievement[];
  className?: string;
}

export function AchievementGrid({ achievements, className = "" }: AchievementGridProps) {
  const sorted = [...achievements].sort((a, b) => {
    // Sort by unlocked first, then by rarity
    if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
    const rarityOrder = { legendary: 0, epic: 1, rare: 2, common: 3 };
    return rarityOrder[a.rarity] - rarityOrder[b.rarity];
  });

  return (
    <div className={`grid grid-cols-5 gap-2 ${className}`}>
      {sorted.map((achievement) => (
        <AchievementBadge key={achievement.id} achievement={achievement} size="md" />
      ))}
    </div>
  );
}

// =============================================================================
// ACHIEVEMENT UNLOCK POPUP - Celebration when unlocking
// =============================================================================

interface AchievementUnlockPopupProps {
  achievement: Achievement | null;
  show: boolean;
  onComplete?: () => void;
}

export function AchievementUnlockPopup({ achievement, show, onComplete }: AchievementUnlockPopupProps) {
  if (!achievement) return null;

  const colors = RARITY_COLORS[achievement.rarity];
  const Icon = ACHIEVEMENT_ICONS[achievement.id] || Star;

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
          className="fixed inset-0 flex items-center justify-center pointer-events-none z-50"
        >
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", damping: 15 }}
            className="text-center p-8 bg-gray-900/90 rounded-2xl border border-gray-700"
          >
            {/* Badge */}
            <motion.div
              className={`
                w-24 h-24 mx-auto mb-4 rounded-2xl
                bg-gradient-to-br ${colors.bg}
                flex items-center justify-center
              `}
              animate={{
                boxShadow: [
                  `0 0 20px ${colors.glow}`,
                  `0 0 40px ${colors.glow}`,
                  `0 0 20px ${colors.glow}`,
                ],
              }}
              transition={{ duration: 1, repeat: Infinity }}
            >
              <Icon className="w-12 h-12 text-white" />
            </motion.div>

            {/* Text */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <p className="text-sm text-gray-400 uppercase tracking-wider">Achievement Unlocked</p>
              <h3 className={`text-2xl font-black mt-1 ${colors.text}`}>
                {achievement.name}
              </h3>
              <p className="text-sm text-gray-500 mt-1">{achievement.description}</p>

              {/* XP Reward */}
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.4, type: "spring" }}
                className="inline-flex items-center gap-1 mt-3 px-3 py-1 rounded-full bg-purple-500/20 border border-purple-500/50"
              >
                <Zap className="w-4 h-4 text-purple-400" />
                <span className="font-bold text-purple-300">+{achievement.xpReward} XP</span>
              </motion.div>
            </motion.div>

            {/* Particles */}
            {[...Array(12)].map((_, i) => (
              <motion.div
                key={i}
                className="absolute w-2 h-2 rounded-full"
                style={{ backgroundColor: colors.glow.replace("0.5", "1").replace("rgba", "rgb").replace(",", "").replace(")", ")") }}
                initial={{
                  x: 0,
                  y: 0,
                  scale: 0,
                }}
                animate={{
                  x: Math.cos((i / 12) * Math.PI * 2) * 100,
                  y: Math.sin((i / 12) * Math.PI * 2) * 100,
                  scale: [0, 1, 0],
                  opacity: [0, 1, 0],
                }}
                transition={{
                  duration: 1,
                  delay: 0.3 + i * 0.05,
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
// MINI ACHIEVEMENT ROW - Compact horizontal display
// =============================================================================

interface MiniAchievementRowProps {
  achievements: Achievement[];
  maxShow?: number;
  className?: string;
}

export function MiniAchievementRow({ achievements, maxShow = 5, className = "" }: MiniAchievementRowProps) {
  const unlocked = achievements.filter(a => a.unlocked);
  const toShow = unlocked.slice(0, maxShow);
  const remaining = unlocked.length - maxShow;

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {toShow.map((achievement) => (
        <AchievementBadge key={achievement.id} achievement={achievement} size="sm" />
      ))}
      {remaining > 0 && (
        <div className="w-10 h-10 rounded-xl bg-gray-800 border border-gray-700 flex items-center justify-center">
          <span className="text-xs text-gray-400 font-bold">+{remaining}</span>
        </div>
      )}
    </div>
  );
}
