'use client';

import type { MiniProfile } from '../../types/profile';
import { Avatar } from './Avatar';
import { UserLabel } from './UserLabel';
import { displayName } from '../../lib/format';

interface MiniProfileCardProps { profile: MiniProfile; stat?: { label: string; value: string }; onClick?: () => void; }

export function MiniProfileCard({ profile, stat, onClick }: MiniProfileCardProps) {
  const name = displayName({ handle: profile.handle, displayName: profile.displayName, wallet: profile.wallet }, profile.wallet);
  return (
    <div className={`flex items-center gap-3 bg-[#111111] border border-[#1a1a1a] rounded-lg px-3 py-2 ${onClick ? 'cursor-pointer hover:border-[#00ff88]/20 transition-colors' : ''}`} onClick={onClick}>
      <Avatar address={profile.wallet} avatarUrl={profile.avatarUrl} size={40} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-mono font-medium text-[#e0e0e0] truncate">{name}</span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#00ff88]/10 text-[#00ff88]">{profile.level}</span>
          {profile.labels.slice(0, 1).map((l) => <UserLabel key={l.label} label={l} size="sm" />)}
        </div>
        {profile.handle && profile.displayName && <div className="text-[10px] font-mono text-[#666666]">@{profile.handle}</div>}
      </div>
      {stat && (
        <div className="text-right">
          <div className="text-[10px] font-mono text-[#666666]">{stat.label}</div>
          <div className="text-sm font-mono font-bold text-[#e0e0e0]">{stat.value}</div>
        </div>
      )}
    </div>
  );
}
