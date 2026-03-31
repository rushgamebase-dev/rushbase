'use client';

import type { UserStats } from '../../types/profile';
import { formatVolume, formatWinRate, formatNumber } from '../../lib/format';

interface StatsGridProps { stats: UserStats; compact?: boolean; }
interface StatItem { label: string; value: string; color?: 'green' | 'red' | 'default'; }

export function StatsGrid({ stats, compact = false }: StatsGridProps) {
  const pnl = parseFloat(stats.totalPnl);
  const pnlColor = pnl > 0 ? 'green' : pnl < 0 ? 'red' : 'default';
  const items: StatItem[] = [
    { label: 'Total Bets', value: formatNumber(stats.totalBets) },
    { label: 'Win Rate', value: formatWinRate(stats.winRate), color: stats.winRate > 0.5 ? 'green' : 'default' },
    { label: 'Volume', value: formatVolume(stats.totalVolume) },
    { label: 'P&L', value: `${pnl >= 0 ? '+' : ''}${formatVolume(stats.totalPnl)}`, color: pnlColor },
  ];
  if (!compact) {
    items.push(
      { label: 'Wins', value: stats.totalWins.toString(), color: 'green' },
      { label: 'Losses', value: stats.totalLosses.toString(), color: 'red' },
      { label: 'Biggest Win', value: formatVolume(stats.biggestWin), color: 'green' },
      { label: 'Best Streak', value: `${stats.bestStreak}🔥` },
    );
  }
  const colorMap = { green: 'text-[#00ff88]', red: 'text-[#ff4444]', default: 'text-[#e0e0e0]' };
  return (
    <div className={`grid gap-3 ${compact ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2 md:grid-cols-4'}`}>
      {items.map((item) => (
        <div key={item.label} className="bg-[#111111] border border-[#1a1a1a] rounded-lg p-3">
          <div className="text-[10px] font-mono uppercase tracking-wider text-[#666666] mb-1">{item.label}</div>
          <div className={`text-lg font-mono font-bold ${colorMap[item.color || 'default']}`}>{item.value}</div>
        </div>
      ))}
    </div>
  );
}
