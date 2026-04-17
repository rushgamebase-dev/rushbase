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

// Compound user title — combines traits for distinctive personality.
// Priority: streak > volume+wr > wr > volume > bets-based.
export function getUserTitle(stats: UserStats | null | undefined): { title: string; icon: string } | null {
  if (!stats) return null;
  const volume = parseFloat(stats.totalVolume);
  const wr = stats.winRate;
  const bets = stats.totalBets;
  const bestStreak = stats.bestStreak;

  // Streak-dominant
  if (bestStreak >= 10) return { title: 'Unstoppable Hunter', icon: '💎' };
  if (stats.currentStreak >= 5) return { title: 'On Fire', icon: '🔥' };
  if (bestStreak >= 5 && wr >= 0.55) return { title: 'Relentless Sharp', icon: '⚡' };

  // Volume + WR combos
  if (volume >= 50) return { title: 'Diamond Hands', icon: '💎' };
  if (volume >= 10 && wr >= 0.55) return { title: 'High Volume Whale', icon: '🐋' };
  if (volume >= 10) return { title: 'Aggressive Whale', icon: '🐋' };
  if (volume >= 1 && wr >= 0.6) return { title: 'Sharp High Roller', icon: '🧠' };
  if (volume >= 1 && bets >= 100) return { title: 'Committed Roller', icon: '🎰' };
  if (volume >= 1) return { title: 'High Roller', icon: '🎰' };

  // WR-dominant
  if (wr >= 0.65 && bets >= 50) return { title: 'Sharp Assassin', icon: '🎯' };
  if (wr >= 0.6 && bets >= 50) return { title: 'Sharp Trader', icon: '🧠' };
  if (wr >= 0.6 && bets >= 20) return { title: 'Sharp Hunter', icon: '🎯' };

  // Bets-based
  if (bets >= 500) return { title: 'Veteran Grinder', icon: '🎖️' };
  if (bets >= 100) return { title: 'Dedicated Grinder', icon: '📊' };
  if (bets >= 50) return { title: 'Regular Bettor', icon: '🎲' };
  if (bets >= 10) return { title: 'Up-and-Comer', icon: '🌱' };
  if (bets >= 1) return { title: 'Car Hunter', icon: '🏎️' };

  return { title: 'Newcomer', icon: '👋' };
}

export interface LevelProgress {
  level: number;
  title: string;
  icon: string;
  color: string;
  xpCurrent: number;
  xpInto: number;
  xpNeeded: number;
  xpToNext: number;
  percent: number;
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

// ─────────────────────────────────────────────────────────────────
// Win rate label — 3 tiers per brief
// ─────────────────────────────────────────────────────────────────

export function getWinRateBadge(wr: number, bets: number): { label: string; icon: string; color: string } | null {
  if (bets < 5) return null;
  if (wr > 0.6)  return { label: 'Hot',      icon: '🔥', color: '#00ff88' };
  if (wr >= 0.4) return { label: 'Balanced', icon: '⚖️', color: '#aaaaaa' };
  return { label: 'Risky', icon: '📉', color: '#ff4444' };
}

// ─────────────────────────────────────────────────────────────────
// Momentum — derived from current streak + winRate
// ─────────────────────────────────────────────────────────────────

export function getMomentum(stats: UserStats | null | undefined): { label: string; icon: string; color: string } | null {
  if (!stats || stats.totalBets < 5) return null;
  if (stats.currentStreak >= 3) return { label: 'Improving',     icon: '📈', color: '#00ff88' };
  if (stats.currentStreak >= 1 && stats.winRate >= 0.5) return { label: 'Warming up', icon: '↗️', color: '#00aaff' };
  if (stats.currentStreak === 0 && stats.winRate < 0.4)  return { label: 'Losing streak', icon: '📉', color: '#ff4444' };
  return { label: 'Even', icon: '⚖️', color: '#888888' };
}

// ─────────────────────────────────────────────────────────────────
// Best rank summary — pick the strongest category (percentile ≤ 25)
// ─────────────────────────────────────────────────────────────────

import type { UserRank } from '../types/profile';

export function getBestRank(rank: UserRank | null | undefined): { label: string; percentile: number } | null {
  if (!rank) return null;
  const cats: Array<{ key: 'volume' | 'pnl' | 'wins'; title: string; pct: number }> = [
    { key: 'volume', title: 'Volume', pct: rank.volume.percentile },
    { key: 'pnl',    title: 'P&L',    pct: rank.pnl.percentile },
    { key: 'wins',   title: 'Wins',   pct: rank.wins.percentile },
  ];
  cats.sort((a, b) => a.pct - b.pct);
  const best = cats[0];
  if (best.pct > 25) return null; // not flex-worthy
  return { label: `Top ${best.pct}% · ${best.title}`, percentile: best.pct };
}

// ─────────────────────────────────────────────────────────────────
// XP rewards per badge slug — keep in sync with seed/auto-grant scripts
// ─────────────────────────────────────────────────────────────────

export const BADGE_XP_REWARD: Record<string, number> = {
  'first-bet': 50, 'ten-bets': 100, 'fifty-bets': 250, 'hundred-bets': 500, 'five-hundred-bets': 1000,
  'first-win': 50, 'ten-wins': 200, 'fifty-wins': 500,
  'streak-3': 100, 'streak-5': 200, 'streak-10': 500,
  'high-roller': 200, 'whale': 1000, 'diamond-hands': 2500,
  'beta-tester': 100, 'early-player': 50, 'verified': 0, 'founder': 500,
};

// ─────────────────────────────────────────────────────────────────
// Next-badge goal: concrete, progressable CTA
// ─────────────────────────────────────────────────────────────────

export interface NextBadgeGoal {
  slug: string;
  name: string;
  icon: string;
  description: string;
  deltaLabel: string;
  current: number;
  target: number;
  percent: number;
  xpReward: number;
}

const BADGE_ICON: Record<string, string> = {
  'first-bet': '🎯', 'ten-bets': '🎲', 'fifty-bets': '📊', 'hundred-bets': '💯',
  'five-hundred-bets': '🏆', 'first-win': '🏅', 'ten-wins': '🔥', 'fifty-wins': '🎖️',
  'streak-3': '⚡', 'streak-5': '🔥', 'streak-10': '💎', 'high-roller': '🎰',
  'whale': '🐋', 'diamond-hands': '💎',
};

export function getNextBadgeGoal(
  stats: UserStats | null | undefined,
  earnedSlugs: Set<string>,
): NextBadgeGoal | null {
  if (!stats) return null;
  const bets = stats.totalBets;
  const wins = stats.totalWins;
  const streak = stats.currentStreak;
  const volume = parseFloat(stats.totalVolume);

  type Row = { slug: string; name: string; description: string; current: number; target: number; delta: (d: number) => string };

  const candidates: Row[] = [
    { slug: 'first-bet',         name: 'First Bet',        description: 'Place your first bet',  current: bets,   target: 1,   delta: () => 'Place a bet' },
    { slug: 'ten-bets',          name: 'Getting Started',  description: 'Place 10 bets',         current: bets,   target: 10,  delta: (d) => `${d} more bet${d === 1 ? '' : 's'}` },
    { slug: 'fifty-bets',        name: 'Regular',          description: 'Place 50 bets',         current: bets,   target: 50,  delta: (d) => `${d} more bets` },
    { slug: 'hundred-bets',      name: 'Centurion',        description: 'Place 100 bets',        current: bets,   target: 100, delta: (d) => `${d} more bets` },
    { slug: 'five-hundred-bets', name: 'Veteran',          description: 'Place 500 bets',        current: bets,   target: 500, delta: (d) => `${d} more bets` },
    { slug: 'first-win',         name: 'Winner',           description: 'Win your first bet',    current: wins,   target: 1,   delta: () => 'Win a bet' },
    { slug: 'ten-wins',          name: 'On a Roll',        description: 'Win 10 bets',           current: wins,   target: 10,  delta: (d) => `Win ${d} more` },
    { slug: 'fifty-wins',        name: 'Sharpshooter',     description: 'Win 50 bets',           current: wins,   target: 50,  delta: (d) => `Win ${d} more` },
    { slug: 'streak-3',          name: 'Hot Hand',         description: '3 wins in a row',       current: streak, target: 3,   delta: (d) => `${d} more win${d === 1 ? '' : 's'} streak` },
    { slug: 'streak-5',          name: 'On Fire',          description: '5 wins in a row',       current: streak, target: 5,   delta: (d) => `${d} more wins streak` },
    { slug: 'streak-10',         name: 'Unstoppable',      description: '10 wins in a row',      current: streak, target: 10,  delta: (d) => `${d} more wins streak` },
    { slug: 'high-roller',       name: 'High Roller',      description: 'Wager 1 ETH total',     current: volume, target: 1,   delta: (d) => `${d.toFixed(2)} ETH more` },
    { slug: 'whale',             name: 'Whale',            description: 'Wager 10 ETH total',    current: volume, target: 10,  delta: (d) => `${d.toFixed(1)} ETH more` },
    { slug: 'diamond-hands',     name: 'Diamond Hands',    description: 'Wager 50 ETH total',    current: volume, target: 50,  delta: (d) => `${d.toFixed(0)} ETH more` },
  ];

  const unearned = candidates.filter((c) => !earnedSlugs.has(c.slug) && c.current < c.target);
  if (!unearned.length) return null;

  // Pick the one closest to unlock (highest progress ratio)
  unearned.sort((a, b) => (b.current / b.target) - (a.current / a.target));
  const top = unearned[0];
  const delta = Math.max(0, top.target - top.current);
  return {
    slug: top.slug,
    name: top.name,
    icon: BADGE_ICON[top.slug] || '🎖️',
    description: top.description,
    deltaLabel: top.delta(delta),
    current: top.current,
    target: top.target,
    percent: Math.min(100, (top.current / top.target) * 100),
    xpReward: BADGE_XP_REWARD[top.slug] ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────────
// Featured badge: most "prestigious" earned badge
// ─────────────────────────────────────────────────────────────────

const PRESTIGE_ORDER = [
  'founder', 'diamond-hands', 'whale', 'streak-10', 'five-hundred-bets',
  'fifty-wins', 'streak-5', 'hundred-bets', 'high-roller', 'verified',
  'streak-3', 'fifty-bets', 'ten-wins', 'beta-tester', 'early-player',
  'ten-bets', 'first-win', 'first-bet',
];

export function getFeaturedBadgeSlug(earnedSlugs: string[]): string | null {
  for (const slug of PRESTIGE_ORDER) {
    if (earnedSlugs.includes(slug)) return slug;
  }
  return earnedSlugs[0] || null;
}
