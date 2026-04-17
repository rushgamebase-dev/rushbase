'use client';

import type { ProfileCardData, UserStats, BadgeEarned } from '../../types/profile';
import { Avatar } from './Avatar';
import { shortenAddress, formatVolume, formatWinRate, formatNumber, formatRelativeTime, formatPnl } from '../../lib/format';
import { getLevelTier, getUserTitle, getLevelProgress, getNextMilestone } from '../../lib/progression';

interface ProfileCardProps {
  data: ProfileCardData;
  stats?: UserStats | null;
  badges?: BadgeEarned[];
  isOwnProfile?: boolean;
  onEditClick?: () => void;
}

const BADGE_ICONS: Record<string, string> = {
  'first-bet': '🎯', 'ten-bets': '🎲', 'fifty-bets': '📊', 'hundred-bets': '💯',
  'five-hundred-bets': '🏆', 'first-win': '🏅', 'ten-wins': '🔥', 'fifty-wins': '🎖️',
  'streak-3': '⚡', 'streak-5': '🔥', 'streak-10': '💎', 'high-roller': '🎰',
  'whale': '🐋', 'diamond-hands': '💎', 'beta-tester': '🧪', 'early-player': '🌱',
  'verified': '✅', 'founder': '⭐',
};

export function ProfileCard({ data, stats, badges, isOwnProfile, onEditClick }: ProfileCardProps) {
  const tier = getLevelTier(data.level);
  const userTitle = getUserTitle(stats ?? null);
  const progress = getLevelProgress(data.xp, data.level);
  const milestone = getNextMilestone(stats ?? null, progress.xpToNext);

  const pnl = formatPnl(data.totalPnl);
  const pnlColor = pnl.isZero ? '#e0e0e0' : pnl.isPositive ? '#00ff88' : '#ff4444';

  const earnedBadges = (badges ?? []).filter((b) => b.isEarned);
  const hotStreak = stats && stats.currentStreak >= 3;
  const displayedName = data.displayName || (data.handle ? `@${data.handle}` : shortenAddress(data.wallet));

  return (
    <div className="w-full space-y-5">
      {/* ─── HERO ─────────────────────────────────────────────── */}
      <section
        className="relative overflow-hidden rounded-2xl border"
        style={{
          borderColor: `${tier.color}33`,
          background: `
            radial-gradient(circle at 12% -20%, ${tier.color}26, transparent 55%),
            radial-gradient(circle at 108% 130%, ${tier.color}1a, transparent 60%),
            #0e0e0e
          `,
        }}
      >
        {/* streak badge floating */}
        {hotStreak && (
          <div
            className="absolute top-4 right-4 flex items-center gap-1.5 text-[11px] font-mono font-bold px-2.5 py-1 rounded-full animate-pulse"
            style={{ background: 'rgba(255,68,68,0.12)', color: '#ff6633', border: '1px solid rgba(255,68,68,0.4)' }}
          >
            🔥 {stats!.currentStreak}W STREAK
          </div>
        )}

        {isOwnProfile && onEditClick && (
          <button
            onClick={onEditClick}
            className="absolute top-4 right-4 text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded border border-[#00ff88]/30 text-[#00ff88] hover:bg-[#00ff88]/10 transition-colors"
          >
            Edit
          </button>
        )}

        <div className="p-6 md:p-8 flex flex-col md:flex-row md:items-end gap-6">
          <div className="relative shrink-0">
            <Avatar address={data.wallet} avatarUrl={data.avatarUrl} size={104} />
            <div
              className="absolute -bottom-2 -right-2 flex items-center gap-1 text-xs font-mono font-black px-2 py-1 rounded-lg shadow-lg"
              style={{
                background: '#0a0a0a',
                color: tier.color,
                border: `2px solid ${tier.color}`,
                boxShadow: `0 0 14px ${tier.color}55`,
              }}
            >
              <span className="text-sm">{tier.icon}</span>
              <span>Lv {data.level}</span>
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-3 flex-wrap">
              <h1 className="text-3xl md:text-4xl font-mono font-black text-[#e0e0e0] truncate">
                {displayedName}
              </h1>
              <span
                className="text-xs font-mono font-bold uppercase tracking-[0.15em]"
                style={{ color: tier.color }}
              >
                {tier.title}
              </span>
            </div>

            {userTitle && (
              <div className="mt-1 text-base font-mono text-[#cccccc]">
                <span className="mr-1">{userTitle.icon}</span>
                <span>{userTitle.title}</span>
              </div>
            )}

            <div className="mt-2 text-[11px] font-mono text-[#666]">
              <span>{shortenAddress(data.wallet, 6)}</span>
              <span className="mx-2 text-[#333]">·</span>
              <span>Joined {formatRelativeTime(data.joinedAt)}</span>
            </div>

            {/* XP BAR - full width within hero */}
            <div className="mt-5">
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-[11px] font-mono">
                  <span className="text-[#aaa]">Lv {data.level}</span>
                  <span className="mx-2 text-[#333]">→</span>
                  <span className="text-[#555]">Lv {data.level + 1}</span>
                </span>
                <span className="text-[11px] font-mono text-[#666]">
                  <span style={{ color: tier.color }}>{formatNumber(progress.xpInto)}</span>
                  <span className="text-[#333]"> / </span>
                  <span>{formatNumber(progress.xpNeeded)} XP</span>
                </span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-[#1a1a1a]/80 overflow-hidden relative">
                <div
                  className="h-full rounded-full transition-all duration-1000 ease-out"
                  style={{
                    width: `${Math.max(2, progress.percent)}%`,
                    background: `linear-gradient(90deg, ${tier.color}99 0%, ${tier.color} 100%)`,
                    boxShadow: progress.percent > 70 ? `0 0 10px ${tier.color}88` : `0 0 4px ${tier.color}44`,
                  }}
                />
                {progress.percent > 70 && (
                  <div
                    className="absolute inset-0 rounded-full animate-pulse"
                    style={{ background: `linear-gradient(90deg, transparent 60%, ${tier.color}22)` }}
                  />
                )}
              </div>

              {milestone && (
                <div className="mt-2.5 text-xs font-mono flex items-center gap-2 flex-wrap">
                  <span style={{ color: tier.color }}>▸</span>
                  <span className="text-[#e0e0e0] font-bold">{milestone.label}</span>
                  <span className="text-[#444]">·</span>
                  <span className="text-[#777]">{milestone.detail}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ─── STATS HIERARCHY ──────────────────────────────────── */}
      <section className="grid grid-cols-5 gap-3">
        {/* Win Rate — HERO STAT (big) */}
        <div
          className="col-span-5 md:col-span-3 bg-[#0d0d0d] border border-[#1a1a1a] rounded-xl p-5 relative overflow-hidden"
          style={{
            background: data.winRate > 0.5
              ? 'radial-gradient(circle at 90% 20%, rgba(0,255,136,0.10), transparent 60%), #0d0d0d'
              : '#0d0d0d',
          }}
        >
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#666]">Win Rate</div>
          <div className="mt-1 flex items-baseline gap-3">
            <div
              className="text-5xl font-mono font-black leading-none"
              style={{ color: data.winRate > 0.5 ? '#00ff88' : data.winRate > 0 ? '#e0e0e0' : '#555' }}
            >
              {formatWinRate(data.winRate)}
            </div>
            {stats && (
              <div className="text-[11px] font-mono text-[#666] tracking-wider">
                <span className="text-[#00ff88]">{stats.totalWins}W</span>
                <span className="mx-1 text-[#333]">/</span>
                <span className="text-[#ff4444]">{stats.totalLosses}L</span>
              </div>
            )}
          </div>
          {/* sub bar */}
          {(data.winRate > 0) && (
            <div className="mt-4 h-1.5 w-full rounded-full bg-[#1a1a1a] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${Math.min(100, data.winRate * 100)}%`,
                  background: data.winRate > 0.5 ? '#00ff88' : '#666',
                }}
              />
            </div>
          )}
        </div>

        {/* PnL — HERO STAT (big) */}
        <div
          className="col-span-5 md:col-span-2 bg-[#0d0d0d] border border-[#1a1a1a] rounded-xl p-5 relative overflow-hidden"
          style={{
            background: pnl.isPositive && !pnl.isZero
              ? 'radial-gradient(circle at 10% 100%, rgba(0,255,136,0.10), transparent 60%), #0d0d0d'
              : !pnl.isZero && !pnl.isPositive
                ? 'radial-gradient(circle at 90% 100%, rgba(255,68,68,0.08), transparent 60%), #0d0d0d'
                : '#0d0d0d',
          }}
        >
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#666]">P&amp;L All-Time</div>
          <div
            className="mt-1 text-4xl md:text-5xl font-mono font-black leading-none truncate"
            style={{ color: pnlColor }}
            title={data.totalPnl}
          >
            {pnl.text}
          </div>
          {stats && parseFloat(stats.biggestWin) > 0 && (
            <div className="mt-3 text-[10px] font-mono text-[#666]">
              Biggest win: <span className="text-[#00ff88]">{formatVolume(stats.biggestWin)}</span>
            </div>
          )}
        </div>

        {/* Bets — small */}
        <div className="col-span-2 md:col-span-1 bg-[#0d0d0d] border border-[#1a1a1a] rounded-lg px-4 py-3">
          <div className="text-[9px] font-mono uppercase tracking-[0.18em] text-[#555]">Bets</div>
          <div className="text-2xl font-mono font-bold text-[#e0e0e0] mt-0.5">
            {formatNumber(data.totalBets)}
          </div>
        </div>

        {/* Volume — small */}
        <div className="col-span-3 md:col-span-2 bg-[#0d0d0d] border border-[#1a1a1a] rounded-lg px-4 py-3">
          <div className="text-[9px] font-mono uppercase tracking-[0.18em] text-[#555]">Volume</div>
          <div className="text-2xl font-mono font-bold text-[#e0e0e0] mt-0.5 truncate" title={data.totalVolume}>
            {formatVolume(data.totalVolume)}
          </div>
        </div>

        {/* Best Streak — small */}
        {data.bestStreak > 0 && (
          <div className="col-span-5 md:col-span-2 bg-[#0d0d0d] border border-[#1a1a1a] rounded-lg px-4 py-3">
            <div className="text-[9px] font-mono uppercase tracking-[0.18em] text-[#555]">Best Streak</div>
            <div className="text-2xl font-mono font-bold mt-0.5 flex items-center gap-1.5">
              <span className="text-[#ff6633]">{data.bestStreak}W</span>
              <span className="text-sm">🔥</span>
            </div>
          </div>
        )}
      </section>

      {/* ─── BADGE RAIL ───────────────────────────────────────── */}
      <section className="bg-[#0d0d0d] border border-[#1a1a1a] rounded-xl p-4">
        <div className="flex items-baseline justify-between mb-3">
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#666]">Badges</span>
            {earnedBadges.length > 0 && (
              <span className="text-[10px] font-mono text-[#aaa]">
                <span style={{ color: tier.color }}>{earnedBadges.length}</span>
                <span className="text-[#333]"> / </span>
                <span>{(badges ?? []).length || 18}</span>
              </span>
            )}
          </div>
          {earnedBadges.length === 0 && (
            <span className="text-[10px] font-mono text-[#555]">Earn your first →</span>
          )}
        </div>

        {/* horizontal rail */}
        <div className="flex gap-2 overflow-x-auto scrollbar-none -mx-1 px-1">
          {earnedBadges.length > 0
            ? earnedBadges.map((b) => (
                <div
                  key={b.slug}
                  className="shrink-0 flex flex-col items-center gap-1 w-16 group cursor-default"
                  title={`${b.name}${b.description ? ' — ' + b.description : ''}`}
                >
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl transition-transform group-hover:scale-110"
                    style={{
                      background: `${tier.color}10`,
                      border: `1.5px solid ${tier.color}44`,
                      boxShadow: `0 0 6px ${tier.color}22`,
                    }}
                  >
                    {b.imageUrl ? (
                      <img src={b.imageUrl} alt={b.name} className="w-8 h-8" />
                    ) : (
                      BADGE_ICONS[b.slug] || '🏷️'
                    )}
                  </div>
                  <span className="text-[9px] font-mono text-center text-[#888] leading-tight truncate w-full">
                    {b.name}
                  </span>
                </div>
              ))
            : (badges ?? []).slice(0, 6).map((b) => (
                <div key={b.slug} className="shrink-0 flex flex-col items-center gap-1 w-16 opacity-25" title={`Locked — ${b.description ?? b.name}`}>
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center text-xl bg-[#1a1a1a] border border-[#222] grayscale">
                    {BADGE_ICONS[b.slug] || '🔒'}
                  </div>
                  <span className="text-[9px] font-mono text-center text-[#444] leading-tight truncate w-full">
                    {b.name}
                  </span>
                </div>
              ))}
        </div>
      </section>
    </div>
  );
}
