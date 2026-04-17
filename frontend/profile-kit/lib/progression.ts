import type { UserStats } from '../types/profile';

export interface LevelTier {
  level: number;
  title: string;
  icon: string;
  color: string;
}

const TIERS: Array<{ minLevel: number; title: string; icon: string; color: string }> = [
  { minLevel: 50, title: 'Legend',    icon: '👑', color: '#ffd700' },
  { minLevel: 30, title: 'Oracle',    icon: '🔮', color: '#a855f7' },
  { minLevel: 15, title: 'Pro',       icon: '💎', color: '#3b82f6' },
  { minLevel: 7,  title: 'Hunter',    icon: '🎯', color: '#00ff88' },
  { minLevel: 3,  title: 'Grinder',   icon: '⚡', color: '#00aaff' },
  { minLevel: 1,  title: 'Rookie',    icon: '🌱', color: '#888888' },
];

export function getLevelTier(level: number): LevelTier {
  const tier = TIERS.find((t) => level >= t.minLevel) ?? TIERS[TIERS.length - 1];
  return { level, title: tier.title, icon: tier.icon, color: tier.color };
}

export function getUserTitle(stats: UserStats | null | undefined): { title: string; icon: string } | null {
  if (!stats) return null;
  const volume = parseFloat(stats.totalVolume);
  const wr = stats.winRate;

  if (stats.bestStreak >= 10) return { title: 'On Fire', icon: '🔥' };
  if (volume >= 10) return { title: 'Whale', icon: '🐋' };
  if (stats.totalBets >= 500) return { title: 'Veteran', icon: '🎖️' };
  if (wr >= 0.6 && stats.totalBets >= 20) return { title: 'Sharp Trader', icon: '🧠' };
  if (volume >= 1) return { title: 'High Roller', icon: '🎰' };
  if (stats.totalBets >= 50) return { title: 'Regular', icon: '📊' };
  if (stats.totalBets >= 1) return { title: 'Car Hunter', icon: '🏎️' };
  return null;
}

export interface LevelProgress {
  level: number;
  title: string;
  icon: string;
  color: string;
  xpCurrent: number;
  xpInto: number;        // XP accumulated into current level
  xpNeeded: number;      // XP span of current level
  xpToNext: number;      // XP remaining until next level
  percent: number;       // 0-100
}

function xpRequiredForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.floor(100 * Math.pow(level, 1.5));
}

export function getLevelProgress(xp: number, level: number): LevelProgress {
  const tier = getLevelTier(level);
  const floor = xpRequiredForLevel(level);
  const ceiling = xpRequiredForLevel(level + 1);
  const span = Math.max(1, ceiling - floor);
  const into = Math.max(0, xp - floor);
  const remaining = Math.max(0, ceiling - xp);
  return {
    level,
    title: tier.title,
    icon: tier.icon,
    color: tier.color,
    xpCurrent: xp,
    xpInto: into,
    xpNeeded: span,
    xpToNext: remaining,
    percent: Math.min(100, (into / span) * 100),
  };
}

export interface NextMilestone {
  label: string;
  detail: string;
}

export function getNextMilestone(stats: UserStats | null | undefined, xpToNextLevel: number): NextMilestone | null {
  if (!stats) return null;

  // XP econômica: ~35 XP por aposta (10 base + ~25 da vitória) — arredondado
  const avgXpPerBet = 35;
  const betsNeeded = Math.ceil(xpToNextLevel / avgXpPerBet);

  if (stats.totalBets === 0) {
    return { label: 'Place your first bet', detail: 'Unlocks the First Bet badge + 10 XP' };
  }

  if (stats.totalBets < 10) {
    const need = 10 - stats.totalBets;
    return { label: `${need} bet${need === 1 ? '' : 's'} until Getting Started`, detail: '+100 XP badge' };
  }

  if (stats.totalBets < 50) {
    const need = 50 - stats.totalBets;
    return { label: `${need} bets until Regular badge`, detail: '+250 XP' };
  }

  if (stats.bestStreak < 3) {
    return { label: 'Get a 3-win streak', detail: 'Unlocks Hot Hand + 100 XP' };
  }

  return { label: `~${betsNeeded} win${betsNeeded === 1 ? '' : 's'} until Lv ${stats.level + 1}`, detail: `${xpToNextLevel} XP remaining` };
}
