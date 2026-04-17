'use client';

import type { ProfileCardData } from '../../types/profile';
import { Avatar } from './Avatar';
import { XPBar } from './XPBar';
import { ProfileBadges } from './ProfileBadges';
import { shortenAddress, formatVolume, formatWinRate, formatNumber, formatRelativeTime } from '../../lib/format';

interface ProfileCardProps { data: ProfileCardData; isOwnProfile?: boolean; onEditClick?: () => void; }

export function ProfileCard({ data, isOwnProfile, onEditClick }: ProfileCardProps) {
  const pnl = parseFloat(data.totalPnl);
  const pnlColor = pnl > 0 ? 'text-[#00ff88]' : pnl < 0 ? 'text-[#ff4444]' : 'text-[#e0e0e0]';
  return (
    <div className="bg-[#111111] border border-[#1a1a1a] rounded-xl p-6 w-full">
      <div className="flex items-start gap-4 mb-4">
        <Avatar address={data.wallet} avatarUrl={data.avatarUrl} size={64} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-mono font-bold text-[#e0e0e0] truncate">
              {data.displayName || (data.handle ? `@${data.handle}` : shortenAddress(data.wallet))}
            </h2>
          </div>
          {data.handle && data.displayName && <div className="text-xs font-mono text-[#666666]">@{data.handle}</div>}
          <div className="text-xs font-mono text-[#666666] mt-0.5">{shortenAddress(data.wallet, 6)}</div>
        </div>
        {isOwnProfile && onEditClick && (
          <button onClick={onEditClick} className="text-xs font-mono text-[#00ff88] border border-[#00ff88]/30 rounded px-2 py-1 hover:bg-[#00ff88]/10 transition-colors">Edit Profile</button>
        )}
      </div>
      <div className="mb-4"><XPBar level={data.level} currentXp={data.xp} xpToNextLevel={data.xpToNextLevel} /></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Bets', value: formatNumber(data.totalBets), color: '' },
          { label: 'Win Rate', value: formatWinRate(data.winRate), color: data.winRate > 0.5 ? 'text-[#00ff88]' : '' },
          { label: 'Volume', value: formatVolume(data.totalVolume), color: '' },
          { label: 'P&L', value: `${pnl >= 0 ? '+' : ''}${formatVolume(data.totalPnl)}`, color: pnlColor },
        ].map((s) => (
          <div key={s.label} className="text-center">
            <div className="text-[10px] font-mono uppercase tracking-wider text-[#666666]">{s.label}</div>
            <div className={`text-lg font-mono font-bold ${s.color || 'text-[#e0e0e0]'}`}>{s.value}</div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <ProfileBadges badges={data.badges.map((b) => ({ ...b, earnedAt: null, isEarned: true }))} layout="row" maxVisible={5} />
        <span className="text-[10px] font-mono text-[#666666]">Joined {formatRelativeTime(data.joinedAt)}</span>
      </div>
    </div>
  );
}
