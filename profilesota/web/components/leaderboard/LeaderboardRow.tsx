'use client';

import type { LeaderboardEntry } from '../../types/profile';
import { Avatar } from '../profile/Avatar';
import { displayName } from '../../lib/format';

const RANK_STYLES: Record<number, string> = { 1: 'text-[#ffd700] font-bold', 2: 'text-[#c0c0c0] font-bold', 3: 'text-[#cd7f32] font-bold' };

export function LeaderboardRow({ entry, isCurrentUser }: { entry: LeaderboardEntry; isCurrentUser?: boolean }) {
  const name = displayName({ handle: entry.handle, displayName: entry.displayName, wallet: entry.wallet }, entry.wallet);
  return (
    <div className={`flex items-center gap-4 py-3 px-4 border-b border-[#1a1a1a] transition-colors ${isCurrentUser ? 'bg-[#00ff88]/5 border-l-2 border-l-[#00ff88]' : ''}`}>
      <span className={`w-8 text-center font-mono text-sm ${RANK_STYLES[entry.rank] || 'text-[#666666]'}`}>
        {entry.rank <= 3 ? ['🥇', '🥈', '🥉'][entry.rank - 1] : `#${entry.rank}`}
      </span>
      <Avatar address={entry.wallet} avatarUrl={entry.avatarUrl} size={32} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-mono text-[#e0e0e0] truncate">{name}</span>
          <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-[#00ff88]/10 text-[#00ff88]">{entry.level}</span>
        </div>
      </div>
      <span className="text-sm font-mono font-bold text-[#e0e0e0]">{entry.value}</span>
    </div>
  );
}
