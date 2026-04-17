'use client';

import type { ProfileCardData, UserStats, BadgeEarned } from '../../types/profile';
import { Avatar } from './Avatar';
import { ProfileBadges } from './ProfileBadges';
import { shortenAddress, formatVolume, formatWinRate, formatNumber, formatRelativeTime, formatPnl } from '../../lib/format';
import { getLevelTier, getUserTitle, getLevelProgress, getNextMilestone } from '../../lib/progression';

interface ProfileCardProps {
  data: ProfileCardData;
  stats?: UserStats | null;
  badges?: BadgeEarned[];
  isOwnProfile?: boolean;
  onEditClick?: () => void;
}

export function ProfileCard({ data, stats, badges, isOwnProfile, onEditClick }: ProfileCardProps) {
  const tier = getLevelTier(data.level);
  const userTitle = getUserTitle(stats ?? null);
  const progress = getLevelProgress(data.xp, data.level);
  const milestone = getNextMilestone(stats ?? null, progress.xpToNext);

  const pnl = formatPnl(data.totalPnl);
  const pnlColor = pnl.isZero ? 'text-[#e0e0e0]' : pnl.isPositive ? 'text-[#00ff88]' : 'text-[#ff4444]';

  const earnedBadges = (badges ?? []).filter((b) => b.isEarned).slice(0, 5);
  const badgesForCard: BadgeEarned[] = earnedBadges.length
    ? earnedBadges
    : (badges ?? []).slice(0, 5).map((b) => ({ ...b, isEarned: false, earnedAt: null }));

  return (
    <div className="bg-[#111111] border border-[#1a1a1a] rounded-xl p-6 w-full space-y-5">
      {/* Row 1 — Avatar + identity */}
      <div className="flex items-start gap-4">
        <div className="relative shrink-0">
          <Avatar address={data.wallet} avatarUrl={data.avatarUrl} size={72} />
          <span
            className="absolute -bottom-1 -right-1 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md border"
            style={{ background: '#0a0a0a', color: tier.color, borderColor: `${tier.color}55` }}
            title={`Level ${data.level} — ${tier.title}`}
          >
            {tier.icon} Lv {data.level}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-mono font-bold text-[#e0e0e0] truncate">
              {data.displayName || (data.handle ? `@${data.handle}` : shortenAddress(data.wallet))}
            </h2>
            <span
              className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded"
              style={{ color: tier.color, background: `${tier.color}12`, border: `1px solid ${tier.color}33` }}
            >
              {tier.title}
            </span>
          </div>
          {userTitle && (
            <div className="text-xs font-mono text-[#aaaaaa] mt-1">
              <span className="mr-1">{userTitle.icon}</span>
              {userTitle.title}
            </div>
          )}
          <div className="text-[11px] font-mono text-[#666666] mt-1">
            {data.handle && data.displayName && <span className="mr-2">@{data.handle}</span>}
            <span>{shortenAddress(data.wallet, 6)}</span>
            <span className="mx-2 text-[#333]">·</span>
            <span>Joined {formatRelativeTime(data.joinedAt)}</span>
          </div>
        </div>

        {isOwnProfile && onEditClick && (
          <button
            onClick={onEditClick}
            className="text-[11px] font-mono text-[#00ff88] border border-[#00ff88]/30 rounded px-2.5 py-1 hover:bg-[#00ff88]/10 transition-colors"
          >
            Edit
          </button>
        )}
      </div>

      {/* Row 2 — XP + progress */}
      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[#666666]">XP</span>
          <span className="text-[10px] font-mono text-[#888]">
            <span className="text-[#e0e0e0]">{formatNumber(progress.xpInto)}</span>
            <span className="text-[#444]"> / </span>
            <span>{formatNumber(progress.xpNeeded)}</span>
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-[#1a1a1a] overflow-hidden relative">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${progress.percent}%`,
              background: `linear-gradient(90deg, ${tier.color}aa, ${tier.color})`,
              boxShadow: progress.percent > 80 ? `0 0 8px ${tier.color}66` : 'none',
            }}
          />
        </div>
        {milestone && (
          <div className="mt-2 text-[11px] font-mono flex items-center gap-2 flex-wrap">
            <span className="text-[#00ff88]">→</span>
            <span className="text-[#e0e0e0]">{milestone.label}</span>
            <span className="text-[#555]">·</span>
            <span className="text-[#666]">{milestone.detail}</span>
          </div>
        )}
      </div>

      {/* Row 3 — Badges (always visible) */}
      <div className="flex items-center justify-between border-t border-[#1a1a1a] pt-4">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono uppercase tracking-wider text-[#666666]">Badges</span>
          <ProfileBadges badges={badgesForCard} layout="row" maxVisible={5} />
        </div>
        {earnedBadges.length === 0 && (
          <span className="text-[10px] font-mono text-[#555]">Earn your first →</span>
        )}
      </div>

      {/* Row 4 — Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Bets" value={formatNumber(data.totalBets)} />
        <StatCard
          label="Win Rate"
          value={formatWinRate(data.winRate)}
          color={data.winRate > 0.5 ? '#00ff88' : data.winRate > 0 ? '#e0e0e0' : '#666'}
        />
        <StatCard label="Volume" value={formatVolume(data.totalVolume)} />
        <StatCard label="P&L" value={pnl.text} colorClass={pnlColor} />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
  colorClass,
}: {
  label: string;
  value: string;
  color?: string;
  colorClass?: string;
}) {
  return (
    <div className="bg-[#0d0d0d] border border-[#1a1a1a] rounded-lg p-3">
      <div className="text-[10px] font-mono uppercase tracking-wider text-[#555] mb-1">{label}</div>
      <div className={`text-lg font-mono font-bold truncate ${colorClass ?? ''}`} style={color ? { color } : undefined} title={value}>
        {value}
      </div>
    </div>
  );
}
