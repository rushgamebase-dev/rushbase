'use client';

import type { ProfileCardData, UserStats, BadgeEarned, UserRank } from '../../types/profile';
import { Avatar } from './Avatar';
import { BadgeMedia } from './BadgeMedia';
import { shortenAddress, formatVolume, formatWinRate, formatNumber, formatRelativeTime, formatRoi } from '../../lib/format';
import {
  getLevelTier, getUserTitle, getLevelProgress,
  getNextBadgeGoal, getFeaturedBadgeSlug,
  getWinRateBadge, getMomentum, getBestRank,
} from '../../lib/progression';

interface ProfileCardProps {
  data: ProfileCardData;
  stats?: UserStats | null;
  rank?: UserRank | null;
  badges?: BadgeEarned[];
  isOwnProfile?: boolean;
  onEditClick?: () => void;
  onBadgesClick?: () => void;
}

const BADGE_ICONS: Record<string, string> = {
  'first-bet': '🎯', 'ten-bets': '🎲', 'fifty-bets': '📊', 'hundred-bets': '💯',
  'five-hundred-bets': '🏆', 'first-win': '🏅', 'ten-wins': '🔥', 'fifty-wins': '🎖️',
  'streak-3': '⚡', 'streak-5': '🔥', 'streak-10': '💎', 'high-roller': '🎰',
  'whale': '🐋', 'diamond-hands': '💎', 'beta-tester': '🧪', 'early-player': '🌱',
  'verified': '✅', 'founder': '⭐',
};

const BADGE_UNLOCK: Record<string, string> = {
  'first-bet': 'Place 1 bet', 'ten-bets': 'Place 10 bets', 'fifty-bets': 'Place 50 bets',
  'hundred-bets': 'Place 100 bets', 'five-hundred-bets': 'Place 500 bets',
  'first-win': 'Win 1 bet', 'ten-wins': 'Win 10 bets', 'fifty-wins': 'Win 50 bets',
  'streak-3': '3-win streak', 'streak-5': '5-win streak', 'streak-10': '10-win streak',
  'high-roller': 'Wager 1 ETH', 'whale': 'Wager 10 ETH', 'diamond-hands': 'Wager 50 ETH',
  'beta-tester': 'Granted in beta', 'early-player': 'Granted in early days',
  'verified': 'Manual verify', 'founder': 'Manual grant',
};

export function ProfileCard({ data, stats, rank, badges, isOwnProfile, onEditClick, onBadgesClick }: ProfileCardProps) {
  const tier = getLevelTier(data.level);
  const userTitle = getUserTitle(stats ?? null);
  const progress = getLevelProgress(data.xp, data.level);
  const wrBadge = getWinRateBadge(data.winRate, data.totalBets);
  const momentum = getMomentum(stats ?? null);
  const bestRank = getBestRank(rank ?? null);

  const earnedBadges = (badges ?? []).filter((b) => b.isEarned);
  const earnedSlugs = new Set(earnedBadges.map((b) => b.slug));
  const nextGoal = getNextBadgeGoal(stats ?? null, earnedSlugs);
  const featuredSlug = getFeaturedBadgeSlug(earnedBadges.map((b) => b.slug));
  const featured = earnedBadges.find((b) => b.slug === featuredSlug) ?? null;
  const otherBadges = earnedBadges.filter((b) => b.slug !== featuredSlug);

  const roi = formatRoi(data.totalPnl, data.totalVolume);
  const roiColor = !roi || roi.isZero ? '#e0e0e0' : roi.isPositive ? '#00ff88' : '#ff4444';
  const wrColor = data.totalBets === 0 ? '#555'
    : data.winRate > 0.6 ? '#00ff88'
    : data.winRate >= 0.4 ? '#e0e0e0'
    : '#ff4444';

  const hotStreak = stats && stats.currentStreak >= 3;
  const displayedName = data.displayName || (data.handle ? `@${data.handle}` : shortenAddress(data.wallet));

  const streakText = data.bestStreak > 0 ? `🔥 ${data.bestStreak} streak` : '🔥 no streak';

  return (
    <article
      className="relative overflow-hidden rounded-2xl border animate-[fadeInUp_0.35s_ease-out]"
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

      {/* ─── IDENTITY BLOCK ─── */}
      <div className="p-5 md:p-7 flex flex-col md:flex-row md:items-center gap-5">
        <div className="shrink-0">
          <Avatar
            address={data.wallet}
            avatarUrl={data.avatarUrl}
            size={96}
            className={`ring-2 ring-offset-2 ring-offset-[#0c0c0c]`}
          />
        </div>

        <div className="flex-1 min-w-0">
          <h1 className="text-3xl md:text-4xl font-mono font-black text-[#e0e0e0] truncate leading-none">
            {displayedName}
          </h1>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <span
              className="text-[10px] font-mono font-black uppercase tracking-[0.15em] px-2 py-0.5 rounded"
              style={{ color: tier.color, background: `${tier.color}12`, border: `1px solid ${tier.color}40` }}
            >
              {tier.icon} Lv {data.level} · {tier.title}
            </span>
            {userTitle && (
              <span className="text-[11px] font-mono text-[#aaa] flex items-center gap-1">
                <span>{userTitle.icon}</span>
                <span>{userTitle.title}</span>
              </span>
            )}
            {bestRank && (
              <span
                className="text-[10px] font-mono font-black uppercase tracking-wider px-2 py-0.5 rounded-md"
                style={{
                  color: '#ffd700',
                  background: 'rgba(255,215,0,0.08)',
                  border: '1px solid rgba(255,215,0,0.35)',
                  boxShadow: '0 0 8px rgba(255,215,0,0.2)',
                }}
                title={`Out of ${rank!.total} active players`}
              >
                🏆 {bestRank.label}
              </span>
            )}
          </div>
          <div className="mt-2 text-[11px] font-mono text-[#666]">
            <span>{shortenAddress(data.wallet, 6)}</span>
            <span className="mx-2 text-[#333]">·</span>
            <span>Joined {formatRelativeTime(data.joinedAt)}</span>
          </div>
        </div>
      </div>

      {/* ─── XP + MISSION ─── */}
      <div className="px-5 md:px-7 pb-5">
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="text-[11px] font-mono text-[#888]">
            <span className="text-[#aaa]">Lv {data.level}</span>
            <span className="mx-1.5 text-[#333]">→</span>
            <span className="text-[#555]">Lv {data.level + 1}</span>
          </span>
          <span className="text-[11px] font-mono text-[#666]">
            <span style={{ color: tier.color }}>{progress.percent.toFixed(0)}%</span>
            <span className="text-[#333]"> · </span>
            <span>{formatNumber(progress.xpInto)}/{formatNumber(progress.xpNeeded)} XP</span>
          </span>
        </div>
        <div className="h-2.5 w-full rounded-full bg-[#1a1a1a]/80 overflow-hidden relative">
          <div
            className="h-full rounded-full transition-all duration-1000 ease-out"
            style={{
              width: `${Math.max(2, progress.percent)}%`,
              background: `linear-gradient(90deg, ${tier.color}99 0%, ${tier.color} 100%)`,
              boxShadow: progress.percent > 70 ? `0 0 12px ${tier.color}aa` : `0 0 4px ${tier.color}44`,
            }}
          />
          {progress.percent > 70 && (
            <div
              className="absolute inset-0 rounded-full animate-pulse pointer-events-none"
              style={{ background: `linear-gradient(90deg, transparent 60%, ${tier.color}22)` }}
            />
          )}
        </div>

        {nextGoal && (
          <div
            className="mt-3 rounded-lg px-3 py-2.5 flex items-center gap-3 border"
            style={{ background: '#0a0a0a', borderColor: '#1a1a1a' }}
          >
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center text-lg shrink-0 opacity-50"
              style={{ background: `${tier.color}10`, border: `1px solid ${tier.color}33` }}
            >
              {nextGoal.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12px] font-mono text-[#e0e0e0] truncate">
                  <span style={{ color: tier.color }}>▸</span>{' '}
                  <span className="font-bold">{nextGoal.deltaLabel}</span>
                  <span className="text-[#555]"> to unlock </span>
                  <span style={{ color: tier.color }}>{nextGoal.name}</span>
                  {nextGoal.xpReward > 0 && (
                    <span className="text-[#888] font-bold"> (+{nextGoal.xpReward} XP)</span>
                  )}
                </span>
                <span className="text-[10px] font-mono text-[#666] shrink-0">
                  {formatNumber(nextGoal.current)}/{formatNumber(nextGoal.target)}
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

      {/* ─── PRIMARY STATS (2 dominant) ─── */}
      <div className="border-t border-[#1a1a1a] grid grid-cols-2">
        {/* Win Rate */}
        <div className="p-5 md:p-6 border-r border-[#1a1a1a]">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#666]">Win Rate</div>
            {wrBadge && (
              <span
                className="text-[9px] font-mono font-black uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{ color: wrBadge.color, background: `${wrBadge.color}12`, border: `1px solid ${wrBadge.color}40` }}
              >
                {wrBadge.icon} {wrBadge.label}
              </span>
            )}
          </div>
          <div className="mt-1.5 flex items-baseline gap-3">
            <div className="text-3xl md:text-4xl font-mono font-black leading-none" style={{ color: wrColor }}>
              {formatWinRate(data.winRate)}
            </div>
            {stats && (data.totalBets > 0) && (
              <div className="text-[10px] font-mono text-[#666] tracking-wider">
                <span className="text-[#00ff88]">{stats.totalWins}W</span>
                <span className="mx-1 text-[#333]">/</span>
                <span className="text-[#ff4444]">{stats.totalLosses}L</span>
              </div>
            )}
          </div>
          <div className="mt-3 h-1 w-full rounded-full bg-[#1a1a1a] overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${Math.max(2, Math.min(100, data.winRate * 100))}%`, background: wrColor }}
            />
          </div>
        </div>

        {/* ROI */}
        <div className="p-5 md:p-6">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#666]">ROI · All-Time</div>
          {roi ? (
            <>
              <div
                className="mt-1.5 text-3xl md:text-4xl font-mono font-black leading-none tracking-tight"
                style={{ color: roiColor }}
              >
                {roi.percentText}
              </div>
              <div className="mt-1.5 text-[11px] font-mono text-[#666]">
                <span style={{ color: roiColor, opacity: 0.7 }}>{roi.ethText}</span>
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
            <>
              <div className="mt-1.5 text-2xl font-mono font-black text-[#555] leading-none">—</div>
              <div className="mt-1.5 text-[11px] font-mono text-[#555]">No activity yet</div>
            </>
          )}
        </div>
      </div>

      {/* ─── SECONDARY MINI-CARDS (3 blocks) ─── */}
      <div className="border-t border-[#1a1a1a] px-5 md:px-6 pt-4 pb-4">
        <div className="grid grid-cols-3 gap-2.5 md:gap-3">
          {/* Bets */}
          <div
            className="relative rounded-xl px-3 py-3 text-center overflow-hidden"
            style={{
              background: 'radial-gradient(circle at 50% 0%, #161616, #0d0d0d 70%)',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.03)',
            }}
          >
            <div className="text-xl md:text-2xl font-mono font-black text-[#e0e0e0] leading-none">
              {formatNumber(data.totalBets)}
            </div>
            <div className="mt-1.5 text-[9px] font-mono uppercase tracking-[0.22em] text-[#555]">Bets</div>
          </div>

          {/* Volume — glow in tier color */}
          <div
            className="relative rounded-xl px-3 py-3 text-center overflow-hidden"
            style={{
              background: `radial-gradient(circle at 50% 100%, ${tier.color}14, #0d0d0d 70%)`,
              boxShadow: `inset 0 0 0 1px ${tier.color}14, 0 0 14px ${tier.color}0f`,
            }}
          >
            <div
              className="text-xl md:text-2xl font-mono font-black leading-none truncate"
              style={{ color: '#e0e0e0', textShadow: `0 0 10px ${tier.color}55` }}
              title={data.totalVolume}
            >
              {formatVolume(data.totalVolume)}
            </div>
            <div className="mt-1.5 text-[9px] font-mono uppercase tracking-[0.22em] text-[#555]">Volume</div>
          </div>

          {/* Streak — dynamic color + pulse if hot */}
          <div
            className="relative rounded-xl px-3 py-3 text-center overflow-hidden"
            style={{
              background: data.bestStreak > 0
                ? 'radial-gradient(circle at 50% 100%, rgba(255,102,51,0.14), #0d0d0d 70%)'
                : 'radial-gradient(circle at 50% 100%, #161616, #0d0d0d 70%)',
              boxShadow: data.bestStreak > 0
                ? 'inset 0 0 0 1px rgba(255,102,51,0.18), 0 0 14px rgba(255,102,51,0.1)'
                : 'inset 0 0 0 1px rgba(255,255,255,0.03)',
            }}
          >
            {data.bestStreak > 0 ? (
              <>
                <div
                  className="text-xl md:text-2xl font-mono font-black leading-none flex items-center justify-center gap-1"
                  style={{ color: '#ff6633', textShadow: '0 0 10px rgba(255,102,51,0.4)' }}
                >
                  <span className={hotStreak ? 'animate-pulse' : ''}>🔥</span>
                  <span>{data.bestStreak}</span>
                </div>
                <div className="mt-1.5 text-[9px] font-mono uppercase tracking-[0.22em]" style={{ color: '#ff663399' }}>
                  Best Streak
                </div>
              </>
            ) : (
              <>
                <div className="text-xl md:text-2xl font-mono font-black leading-none flex items-center justify-center gap-1 text-[#555]">
                  <span className="grayscale opacity-50">🔥</span>
                  <span>0</span>
                </div>
                <div className="mt-1.5 text-[9px] font-mono uppercase tracking-[0.22em] text-[#555]">Streak</div>
              </>
            )}
            {momentum && (
              <div
                className="mt-1.5 text-[9px] font-mono font-bold flex items-center justify-center gap-1"
                style={{ color: momentum.color }}
                title={momentum.label}
              >
                <span>{momentum.icon}</span>
                <span className="truncate">{momentum.label}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── BADGE RAIL — featured + collection ─── */}
      <div className="border-t border-[#1a1a1a] p-5">
        <div className="flex items-baseline justify-between mb-3">
          {onBadgesClick ? (
            <button
              onClick={onBadgesClick}
              className="flex items-baseline gap-2 hover:opacity-80 transition-opacity cursor-pointer"
              title="View full collection"
            >
              <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#666]">Badges</span>
              {earnedBadges.length > 0 && (
                <span className="text-[10px] font-mono text-[#aaa]">
                  <span style={{ color: tier.color }}>{earnedBadges.length}</span>
                  <span className="text-[#333]"> / </span>
                  <span>{(badges ?? []).length || 18}</span>
                </span>
              )}
              <span className="text-[10px] font-mono text-[#555]">→</span>
            </button>
          ) : (
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
          )}
        </div>

        {earnedBadges.length > 0 ? (
          <div className="flex items-stretch gap-4">
            {featured && (
              <button
                onClick={onBadgesClick}
                disabled={!onBadgesClick}
                className="shrink-0 flex flex-col items-center gap-1.5 pr-4 border-r border-[#1a1a1a] min-w-[84px] enabled:cursor-pointer enabled:hover:opacity-90 transition-opacity disabled:cursor-default"
                title={onBadgesClick ? "View full collection" : undefined}
              >
                <div className="text-[8px] font-mono font-black uppercase tracking-[0.2em]" style={{ color: tier.color }}>
                  ★ Featured
                </div>
                <BadgeTile badge={featured} size="lg" tierColor={tier.color} />
                <div className="text-center text-[9px] font-mono font-bold truncate w-full" style={{ color: tier.color }}>
                  {featured.name}
                </div>
              </button>
            )}

            <div className="flex-1 min-w-0 flex flex-col gap-1.5">
              {otherBadges.length > 0 && (
                onBadgesClick ? (
                  <button
                    onClick={onBadgesClick}
                    className="text-[8px] font-mono font-black uppercase tracking-[0.2em] text-[#555] hover:text-[#00ff88] transition-colors text-left cursor-pointer w-fit"
                    title="View full collection"
                  >
                    Collection ({otherBadges.length}) →
                  </button>
                ) : (
                  <div className="text-[8px] font-mono font-black uppercase tracking-[0.2em] text-[#555]">
                    Collection ({otherBadges.length})
                  </div>
                )
              )}
              <div className="flex gap-2 overflow-x-auto scrollbar-none -my-1 py-1">
                {otherBadges.length > 0 ? (
                  otherBadges.map((b) => <BadgeTile key={b.slug} badge={b} size="sm" tierColor={tier.color} />)
                ) : (
                  <div className="text-[11px] font-mono text-[#555] italic py-3">
                    Your first badge sets the tone →
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            {(badges ?? []).slice(0, 6).map((b) => (
              <div key={b.slug} className="shrink-0 opacity-30" title={`Locked — ${BADGE_UNLOCK[b.slug] ?? b.description ?? b.name}`}>
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

function BadgeTile({ badge, size, tierColor }: { badge: BadgeEarned; size: 'sm' | 'lg'; tierColor: string }) {
  const px = size === 'lg' ? 64 : 44;
  const textSize = size === 'lg' ? 'text-3xl' : 'text-xl';
  const unlock = BADGE_UNLOCK[badge.slug] ?? badge.description ?? '';

  return (
    <div className="relative group shrink-0 cursor-default">
      <div
        className={`${textSize} rounded-xl flex items-center justify-center transition-transform group-hover:scale-110`}
        style={{
          width: px,
          height: px,
          background: size === 'lg'
            ? `linear-gradient(135deg, ${tierColor}28, ${tierColor}08)`
            : '#141414',
          border: size === 'lg' ? `2px solid ${tierColor}` : '1px solid #222',
          boxShadow: size === 'lg' ? `0 0 18px ${tierColor}66` : 'none',
        }}
      >
        {badge.imageUrl ? (
          <BadgeMedia url={badge.imageUrl} alt={badge.name} className={size === 'lg' ? 'w-10 h-10' : 'w-7 h-7'} />
        ) : (
          BADGE_ICONS[badge.slug] || '🏷️'
        )}
      </div>
      {/* Hover tooltip */}
      <div
        className="absolute z-30 left-1/2 -translate-x-1/2 top-full mt-2 w-44 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
      >
        <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-lg px-3 py-2 shadow-2xl">
          <div className="text-[11px] font-mono font-bold text-[#e0e0e0] truncate">{badge.name}</div>
          {unlock && (
            <div className="text-[10px] font-mono text-[#666] mt-0.5">
              <span className="text-[#00ff88]">Unlocked:</span> {unlock}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
