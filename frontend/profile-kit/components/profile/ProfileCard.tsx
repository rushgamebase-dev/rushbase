'use client';

import type { ProfileCardData, UserStats, BadgeEarned } from '../../types/profile';
import { Avatar } from './Avatar';
import { shortenAddress, formatVolume, formatWinRate, formatNumber, formatRelativeTime, formatRoi } from '../../lib/format';
import { getLevelTier, getUserTitle, getLevelProgress, getNextBadgeGoal, getFeaturedBadgeSlug } from '../../lib/progression';

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

  const earnedBadges = (badges ?? []).filter((b) => b.isEarned);
  const earnedSlugs = new Set(earnedBadges.map((b) => b.slug));
  const nextGoal = getNextBadgeGoal(stats ?? null, earnedSlugs);
  const featuredSlug = getFeaturedBadgeSlug(earnedBadges.map((b) => b.slug));
  const featured = earnedBadges.find((b) => b.slug === featuredSlug) ?? null;
  const otherBadges = earnedBadges.filter((b) => b.slug !== featuredSlug);

  const roi = formatRoi(data.totalPnl, data.totalVolume);
  const roiColor = !roi || roi.isZero ? '#e0e0e0' : roi.isPositive ? '#00ff88' : '#ff4444';

  const hotStreak = stats && stats.currentStreak >= 3;
  const displayedName = data.displayName || (data.handle ? `@${data.handle}` : shortenAddress(data.wallet));

  return (
    <article
      className="relative overflow-hidden rounded-2xl border"
      style={{
        borderColor: `${tier.color}33`,
        background: `
          radial-gradient(circle at 8% -25%, ${tier.color}30, transparent 55%),
          radial-gradient(circle at 110% 115%, ${tier.color}1a, transparent 55%),
          #0c0c0c
        `,
      }}
    >
      {/* streak floating tag — top-right */}
      {hotStreak && !(isOwnProfile && onEditClick) && (
        <div
          className="absolute top-4 right-4 flex items-center gap-1.5 text-[11px] font-mono font-bold px-2.5 py-1 rounded-full animate-pulse z-10"
          style={{ background: 'rgba(255,68,68,0.12)', color: '#ff6633', border: '1px solid rgba(255,68,68,0.4)' }}
        >
          🔥 {stats!.currentStreak}W STREAK
        </div>
      )}

      {isOwnProfile && onEditClick && (
        <button
          onClick={onEditClick}
          className="absolute top-4 right-4 text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded border border-[#00ff88]/30 text-[#00ff88] hover:bg-[#00ff88]/10 transition-colors z-10"
        >
          Edit
        </button>
      )}

      {/* ─── HERO BLOCK ─── */}
      <div className="p-5 md:p-7 flex flex-col md:flex-row md:items-center gap-5">
        <div className="relative shrink-0">
          <Avatar address={data.wallet} avatarUrl={data.avatarUrl} size={96} />
          <div
            className="absolute -bottom-2 -right-2 flex items-center gap-1 text-xs font-mono font-black px-2 py-0.5 rounded-lg"
            style={{
              background: '#0a0a0a',
              color: tier.color,
              border: `2px solid ${tier.color}`,
              boxShadow: `0 0 12px ${tier.color}66`,
            }}
          >
            <span>{tier.icon}</span>
            <span>Lv {data.level}</span>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1 className="text-3xl md:text-4xl font-mono font-black text-[#e0e0e0] truncate leading-none">
              {displayedName}
            </h1>
            <span
              className="text-[11px] font-mono font-bold uppercase tracking-[0.18em]"
              style={{ color: tier.color }}
            >
              {tier.title}
            </span>
          </div>
          {userTitle && (
            <div className="mt-1.5 text-[15px] font-mono text-[#d0d0d0]">
              <span className="mr-1">{userTitle.icon}</span>
              <span className="font-bold">{userTitle.title}</span>
            </div>
          )}
          <div className="mt-1.5 text-[11px] font-mono text-[#666]">
            <span>{shortenAddress(data.wallet, 6)}</span>
            <span className="mx-2 text-[#333]">·</span>
            <span>Joined {formatRelativeTime(data.joinedAt)}</span>
          </div>
        </div>
      </div>

      {/* ─── XP BAR + NEXT GOAL ─── */}
      <div className="px-5 md:px-7 pb-5">
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="text-[11px] font-mono text-[#888]">
            <span className="text-[#aaa]">Lv {data.level}</span>
            <span className="mx-1.5 text-[#333]">→</span>
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
        </div>

        {/* NEXT BADGE GOAL — concrete CTA */}
        {nextGoal && (
          <div
            className="mt-3 rounded-lg px-3 py-2.5 flex items-center gap-3 border"
            style={{ background: '#0a0a0a', borderColor: '#1a1a1a' }}
          >
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center text-lg shrink-0 opacity-40"
              style={{ background: `${tier.color}10`, border: `1px solid ${tier.color}22` }}
            >
              {nextGoal.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12px] font-mono text-[#e0e0e0] truncate">
                  <span className="text-[#00ff88]">▸</span>{' '}
                  <span className="font-bold">{nextGoal.deltaLabel}</span>
                  <span className="text-[#555]"> to unlock </span>
                  <span style={{ color: tier.color }}>{nextGoal.name}</span>
                </span>
                <span className="text-[10px] font-mono text-[#666] shrink-0">
                  {nextGoal.current}/{nextGoal.target}
                </span>
              </div>
              <div className="mt-1 h-1 w-full rounded-full bg-[#1a1a1a] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${Math.max(2, nextGoal.percent)}%`,
                    background: tier.color,
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── STATS ─── */}
      <div className="border-t border-[#1a1a1a] grid grid-cols-2">
        {/* Win Rate */}
        <div className="p-5 md:p-6 border-r border-[#1a1a1a]">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#666]">Win Rate</div>
          <div className="mt-1.5 flex items-baseline gap-3">
            <div
              className="text-4xl md:text-5xl font-mono font-black leading-none"
              style={{ color: data.winRate > 0.5 ? '#00ff88' : data.winRate > 0 ? '#e0e0e0' : '#555' }}
            >
              {formatWinRate(data.winRate)}
            </div>
            {stats && (data.winRate > 0) && (
              <div className="text-[10px] font-mono text-[#666] tracking-wider">
                <span className="text-[#00ff88]">{stats.totalWins}W</span>
                <span className="mx-1 text-[#333]">/</span>
                <span className="text-[#ff4444]">{stats.totalLosses}L</span>
              </div>
            )}
          </div>
          {data.winRate > 0 && (
            <div className="mt-3 h-1 w-full rounded-full bg-[#1a1a1a] overflow-hidden">
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

        {/* ROI / PnL */}
        <div className="p-5 md:p-6">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#666]">ROI · All-Time</div>
          {roi ? (
            <>
              <div
                className="mt-1.5 text-4xl md:text-5xl font-mono font-black leading-none"
                style={{ color: roiColor }}
              >
                {roi.percentText}
              </div>
              <div className="mt-1.5 text-[11px] font-mono text-[#666]">
                <span style={{ color: roiColor, opacity: 0.75 }}>{roi.ethText}</span>
                {stats && parseFloat(stats.biggestWin) > 0 && (
                  <>
                    <span className="mx-2 text-[#333]">·</span>
                    <span>biggest win </span>
                    <span className="text-[#00ff88]">{formatVolume(stats.biggestWin)}</span>
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="mt-1.5 text-2xl font-mono font-black text-[#555] leading-none">—</div>
          )}
        </div>
      </div>

      {/* ─── SECONDARY STATS (compact row) ─── */}
      <div className="border-t border-[#1a1a1a] grid grid-cols-3 text-center">
        <div className="py-3 border-r border-[#1a1a1a]">
          <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#555]">Bets</div>
          <div className="text-lg font-mono font-bold text-[#e0e0e0] mt-0.5">
            {formatNumber(data.totalBets)}
          </div>
        </div>
        <div className="py-3 border-r border-[#1a1a1a]">
          <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#555]">Volume</div>
          <div className="text-lg font-mono font-bold text-[#e0e0e0] mt-0.5 truncate px-2" title={data.totalVolume}>
            {formatVolume(data.totalVolume)}
          </div>
        </div>
        <div className="py-3">
          <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#555]">Best Streak</div>
          <div className={`text-lg font-mono font-bold mt-0.5 ${data.bestStreak > 0 ? 'text-[#ff6633]' : 'text-[#555]'}`}>
            {data.bestStreak > 0 ? `${data.bestStreak}W 🔥` : '—'}
          </div>
        </div>
      </div>

      {/* ─── BADGE RAIL — featured + rest ─── */}
      <div className="border-t border-[#1a1a1a] p-5">
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
        </div>

        {earnedBadges.length > 0 ? (
          <div className="flex items-center gap-3">
            {featured && (
              <div
                className="shrink-0 relative group cursor-default"
                title={`${featured.name}${featured.description ? ' — ' + featured.description : ''}`}
              >
                <div
                  className="w-16 h-16 rounded-xl flex items-center justify-center text-3xl transition-transform group-hover:scale-105"
                  style={{
                    background: `linear-gradient(135deg, ${tier.color}28, ${tier.color}08)`,
                    border: `2px solid ${tier.color}`,
                    boxShadow: `0 0 16px ${tier.color}55`,
                  }}
                >
                  {featured.imageUrl ? (
                    <img src={featured.imageUrl} alt={featured.name} className="w-10 h-10" />
                  ) : (
                    BADGE_ICONS[featured.slug] || '🏆'
                  )}
                </div>
                <div className="mt-1 text-center text-[9px] font-mono font-bold truncate" style={{ color: tier.color }}>
                  {featured.name}
                </div>
              </div>
            )}

            <div className="flex gap-2 overflow-x-auto scrollbar-none flex-1 -my-1 py-1">
              {otherBadges.map((b) => (
                <div
                  key={b.slug}
                  className="shrink-0 group cursor-default"
                  title={`${b.name}${b.description ? ' — ' + b.description : ''}`}
                >
                  <div
                    className="w-11 h-11 rounded-lg flex items-center justify-center text-xl transition-transform group-hover:scale-110"
                    style={{
                      background: '#141414',
                      border: '1px solid #222',
                    }}
                  >
                    {b.imageUrl ? (
                      <img src={b.imageUrl} alt={b.name} className="w-7 h-7" />
                    ) : (
                      BADGE_ICONS[b.slug] || '🏷️'
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {(badges ?? []).slice(0, 6).map((b) => (
              <div key={b.slug} className="shrink-0 opacity-30" title={`Locked — ${b.description ?? b.name}`}>
                <div className="w-11 h-11 rounded-lg flex items-center justify-center text-lg bg-[#141414] border border-[#222] grayscale">
                  {BADGE_ICONS[b.slug] || '🔒'}
                </div>
              </div>
            ))}
            <span className="ml-2 text-[11px] font-mono text-[#555]">Earn your first →</span>
          </div>
        )}
      </div>
    </article>
  );
}
