'use client';

import type { ProfileCardData } from '../../types/profile';
import { Avatar } from './Avatar';
import { UserLabel } from './UserLabel';
import { XPBar } from './XPBar';
import { ProfileBadges } from './ProfileBadges';
import { shortenAddress, formatVolume, formatWinRate, formatNumber, formatRelativeTime } from '../../lib/format';

interface ProfileCardProps {
  data: ProfileCardData;
  isOwnProfile?: boolean;
  onEditClick?: () => void;
}

export function ProfileCard({ data, isOwnProfile, onEditClick }: ProfileCardProps) {
  const pnl = parseFloat(data.totalPnl);
  const pnlColor = pnl > 0 ? 'text-[#00ff88]' : pnl < 0 ? 'text-[#ff4444]' : 'text-[#e0e0e0]';

  return (
    <div className="bg-[#111111] border border-[#1a1a1a] rounded-xl p-6 w-full">
      {/* Header row */}
      <div className="flex items-start gap-4 mb-4">
        <Avatar
          address={data.wallet}
          avatarUrl={data.avatarUrl}
          size={64}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-mono font-bold text-[#e0e0e0] truncate">
              {data.displayName || data.handle ? `@${data.handle}` : shortenAddress(data.wallet)}
            </h2>
            {data.labels.map((label) => (
              <UserLabel key={label.label} label={label} size="sm" />
            ))}
          </div>

          {data.handle && data.displayName && (
            <div className="text-xs font-mono text-[#666666]">@{data.handle}</div>
          )}

          <div className="text-xs font-mono text-[#666666] mt-0.5">
            {shortenAddress(data.wallet, 6)}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          {isOwnProfile && onEditClick && (
            <button
              onClick={onEditClick}
              className="text-xs font-mono text-[#00ff88] border border-[#00ff88]/30 rounded px-2 py-1 hover:bg-[#00ff88]/10 transition-colors"
            >
              Edit Profile
            </button>
          )}
        </div>
      </div>

      {/* XP Bar */}
      <div className="mb-4">
        <XPBar
          level={data.level}
          currentXp={data.xp}
          xpToNextLevel={data.xpToNextLevel}
        />
      </div>

      {/* Stats mini-grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="text-center">
          <div className="text-[10px] font-mono uppercase tracking-wider text-[#666666]">Bets</div>
          <div className="text-lg font-mono font-bold text-[#e0e0e0]">{formatNumber(data.totalBets)}</div>
        </div>
        <div className="text-center">
          <div className="text-[10px] font-mono uppercase tracking-wider text-[#666666]">Win Rate</div>
          <div className={`text-lg font-mono font-bold ${data.winRate > 0.5 ? 'text-[#00ff88]' : 'text-[#e0e0e0]'}`}>
            {formatWinRate(data.winRate)}
          </div>
        </div>
        <div className="text-center">
          <div className="text-[10px] font-mono uppercase tracking-wider text-[#666666]">Volume</div>
          <div className="text-lg font-mono font-bold text-[#e0e0e0]">{formatVolume(data.totalVolume)}</div>
        </div>
        <div className="text-center">
          <div className="text-[10px] font-mono uppercase tracking-wider text-[#666666]">P&L</div>
          <div className={`text-lg font-mono font-bold ${pnlColor}`}>
            {pnl >= 0 ? '+' : ''}{formatVolume(data.totalPnl)}
          </div>
        </div>
      </div>

      {/* Badges + Joined */}
      <div className="flex items-center justify-between">
        <ProfileBadges
          badges={data.badges.map((b) => ({ ...b, earnedAt: null, isEarned: true }))}
          layout="row"
          maxVisible={5}
        />
        <span className="text-[10px] font-mono text-[#666666]">
          Joined {formatRelativeTime(data.joinedAt)}
        </span>
      </div>
    </div>
  );
}
