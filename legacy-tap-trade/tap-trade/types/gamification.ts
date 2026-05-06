// =============================================================================
// GAMIFICATION TYPES - State-of-the-Art Gaming UX
// =============================================================================

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  unlocked: boolean;
  unlockedAt?: number;
  progress?: number;
  maxProgress?: number;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  xpReward: number;
}

export interface PlayerLevel {
  level: number;
  currentXP: number;
  xpToNextLevel: number;
  totalXP: number;
  title: string;
  badge: string;
}

export interface StreakData {
  current: number;
  max: number;
  multiplier: number;
  isOnFire: boolean; // 3+ streak
  isSuperHot: boolean; // 5+ streak
  isUltra: boolean; // 10+ streak
}

export interface ComboData {
  count: number;
  timer: number; // ms remaining
  multiplier: number;
  active: boolean;
}

export interface ParticleConfig {
  count: number;
  colors: string[];
  spread: number;
  speed: number;
  gravity: number;
  size: number;
  duration: number;
}

export interface ExplosionEffect {
  id: string;
  x: number;
  y: number;
  type: 'win' | 'loss' | 'bigWin' | 'streak' | 'levelUp' | 'achievement';
  intensity: number;
  timestamp: number;
}

export interface ScreenShakeConfig {
  intensity: number;
  duration: number;
  type: 'horizontal' | 'vertical' | 'both' | 'circular';
}

export interface SoundEffect {
  id: string;
  volume: number;
  enabled: boolean;
}

export interface GameSession {
  startTime: number;
  totalBets: number;
  wins: number;
  losses: number;
  netPnL: number;
  biggestWin: number;
  biggestLoss: number;
  longestStreak: number;
  xpEarned: number;
}

// Level titles and thresholds
export const LEVEL_THRESHOLDS = [
  { level: 1, xp: 0, title: 'Rookie Trader', badge: '1' },
  { level: 2, xp: 100, title: 'Apprentice', badge: '2' },
  { level: 3, xp: 300, title: 'Journeyman', badge: '3' },
  { level: 4, xp: 600, title: 'Skilled Trader', badge: '4' },
  { level: 5, xp: 1000, title: 'Expert', badge: '5' },
  { level: 6, xp: 1500, title: 'Master Trader', badge: '6' },
  { level: 7, xp: 2100, title: 'Grandmaster', badge: '7' },
  { level: 8, xp: 2800, title: 'Legend', badge: '8' },
  { level: 9, xp: 3600, title: 'Mythic', badge: '9' },
  { level: 10, xp: 4500, title: 'Immortal', badge: '10' },
  { level: 11, xp: 5500, title: 'Divine', badge: '11' },
  { level: 12, xp: 6600, title: 'Cosmic', badge: '12' },
  { level: 13, xp: 7800, title: 'Transcendent', badge: '13' },
  { level: 14, xp: 9100, title: 'Eternal', badge: '14' },
  { level: 15, xp: 10500, title: 'Supreme', badge: '15' },
];

// Achievement definitions
export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_win', name: 'First Blood', description: 'Win your first trade', icon: '1', unlocked: false, rarity: 'common', xpReward: 10 },
  { id: 'streak_3', name: 'On Fire', description: 'Win 3 trades in a row', icon: '3', unlocked: false, rarity: 'common', xpReward: 25 },
  { id: 'streak_5', name: 'Unstoppable', description: 'Win 5 trades in a row', icon: '5', unlocked: false, rarity: 'rare', xpReward: 50 },
  { id: 'streak_10', name: 'Legendary Streak', description: 'Win 10 trades in a row', icon: '10', unlocked: false, rarity: 'epic', xpReward: 200 },
  { id: 'wins_10', name: 'Getting Started', description: 'Win 10 total trades', icon: '10', unlocked: false, rarity: 'common', xpReward: 30 },
  { id: 'wins_50', name: 'Consistent Winner', description: 'Win 50 total trades', icon: '50', unlocked: false, rarity: 'rare', xpReward: 100 },
  { id: 'wins_100', name: 'Century Club', description: 'Win 100 total trades', icon: '100', unlocked: false, rarity: 'epic', xpReward: 300 },
  { id: 'big_win', name: 'Big Baller', description: 'Win more than $100 on a single trade', icon: '$', unlocked: false, rarity: 'rare', xpReward: 75 },
  { id: 'huge_win', name: 'Whale Alert', description: 'Win more than $500 on a single trade', icon: '$$', unlocked: false, rarity: 'epic', xpReward: 250 },
  { id: 'comeback', name: 'Comeback King', description: 'Go from -$100 to positive', icon: 'C', unlocked: false, rarity: 'epic', xpReward: 150 },
  { id: 'high_roller', name: 'High Roller', description: 'Place a $100+ stake', icon: 'H', unlocked: false, rarity: 'rare', xpReward: 50 },
  { id: 'risk_taker', name: 'Risk Taker', description: 'Win on a 5x+ multiplier', icon: 'R', unlocked: false, rarity: 'epic', xpReward: 100 },
  { id: 'sniper', name: 'Sniper', description: 'Win on a 10x+ multiplier', icon: 'S', unlocked: false, rarity: 'legendary', xpReward: 500 },
];

// Streak multiplier bonuses
export function getStreakMultiplier(streak: number): number {
  if (streak < 2) return 1;
  if (streak === 2) return 1.1;
  if (streak === 3) return 1.2;
  if (streak === 4) return 1.3;
  if (streak === 5) return 1.5;
  if (streak < 10) return 1.5 + (streak - 5) * 0.1;
  return 2.0; // Max 2x bonus at 10+ streak
}

// Calculate XP earned from a trade
export function calculateTradeXP(
  isWin: boolean,
  stake: number,
  multiplier: number,
  streak: number
): number {
  if (!isWin) return 5; // Base XP for any trade

  let xp = 10; // Base XP for a win
  xp += Math.floor(stake / 10); // +1 XP per $10 staked
  xp += Math.floor((multiplier - 1) * 10); // +10 XP per 1x multiplier above 1
  xp += streak * 5; // +5 XP per streak level

  return Math.min(xp, 100); // Cap at 100 XP per trade
}
