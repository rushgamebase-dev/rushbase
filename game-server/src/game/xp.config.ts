// ============================================
// XP SYSTEM - Configuration & Pure Functions
// ============================================

// XP awarded per arena participation
export const XP_PARTICIPATION = 50;

// XP awarded per kill
export const XP_PER_KILL = 25;

// XP awarded by placement (1-indexed)
export const XP_PLACEMENT: Record<number, number> = {
  1: 150, // Winner
  2: 75,
  3: 50,
};

// Level thresholds: totalXP required to REACH each level
// Level 1 = 0 XP, Level 2 = 200 XP, etc.
const LEVEL_THRESHOLDS = [
  0,     // Level 1
  200,   // Level 2
  500,   // Level 3
  1000,  // Level 4
  1800,  // Level 5
  3000,  // Level 6
  4500,  // Level 7
  6500,  // Level 8
  9000,  // Level 9
  12000, // Level 10
];

// After level 10, each level requires +4000 XP more
const POST_10_INCREMENT = 4000;

/** Get the XP threshold required to reach a given level */
export function getXPForLevel(level: number): number {
  if (level <= 1) return 0;
  if (level <= LEVEL_THRESHOLDS.length) return LEVEL_THRESHOLDS[level - 1];
  // Beyond predefined thresholds: level 11 = 16000, 12 = 20000, etc.
  const beyondCount = level - LEVEL_THRESHOLDS.length;
  return LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1] + beyondCount * POST_10_INCREMENT;
}

/** Calculate the level for a given total XP */
export function calculateLevel(totalXP: number): number {
  // Check predefined thresholds first
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (totalXP >= LEVEL_THRESHOLDS[i]) {
      // Check if they're beyond level 10
      if (i === LEVEL_THRESHOLDS.length - 1) {
        const excess = totalXP - LEVEL_THRESHOLDS[i];
        return i + 1 + Math.floor(excess / POST_10_INCREMENT);
      }
      return i + 1;
    }
  }
  return 1;
}

/** Calculate level progress as a 0-1 fraction within the current level */
export function calculateLevelProgress(totalXP: number): {
  level: number;
  currentLevelXP: number;
  nextLevelXP: number;
  progress: number;
  xpToNext: number;
} {
  const level = calculateLevel(totalXP);
  const currentLevelXP = getXPForLevel(level);
  const nextLevelXP = getXPForLevel(level + 1);
  const xpInLevel = totalXP - currentLevelXP;
  const xpNeeded = nextLevelXP - currentLevelXP;
  const progress = xpNeeded > 0 ? Math.min(xpInLevel / xpNeeded, 1) : 0;
  const xpToNext = Math.max(nextLevelXP - totalXP, 0);

  return { level, currentLevelXP, nextLevelXP, progress, xpToNext };
}

/** Calculate XP breakdown for an arena result */
export function calculateXPBreakdown(
  kills: number,
  placement: number,
): { participation: number; kills: number; placement: number; total: number } {
  const participationXP = XP_PARTICIPATION;
  const killsXP = kills * XP_PER_KILL;
  const placementXP = XP_PLACEMENT[placement] || 0;

  return {
    participation: participationXP,
    kills: killsXP,
    placement: placementXP,
    total: participationXP + killsXP + placementXP,
  };
}
