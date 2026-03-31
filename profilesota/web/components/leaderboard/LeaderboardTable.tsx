'use client';

import { useState } from 'react';
import { useLeaderboard } from '../../hooks/useLeaderboard';
import { LeaderboardRow } from './LeaderboardRow';
import type { LeaderboardType } from '../../types/profile';

const TABS: { key: LeaderboardType; label: string }[] = [
  { key: 'volume', label: 'Volume' }, { key: 'wins', label: 'Wins' },
  { key: 'streak', label: 'Streak' }, { key: 'pnl', label: 'P&L' },
];

export function LeaderboardTable({ currentUserId }: { currentUserId?: string }) {
  const [activeTab, setActiveTab] = useState<LeaderboardType>('volume');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useLeaderboard(activeTab, page);

  return (
    <div>
      <div className="flex gap-1 mb-4 border-b border-[#1a1a1a]">
        {TABS.map((tab) => (
          <button key={tab.key} onClick={() => { setActiveTab(tab.key); setPage(1); }}
            className={`text-xs font-mono px-4 py-2 border-b-2 transition-colors ${activeTab === tab.key ? 'text-[#00ff88] border-[#00ff88]' : 'text-[#666666] border-transparent hover:text-[#e0e0e0]'}`}>{tab.label}</button>
        ))}
      </div>
      {isLoading ? (
        <div className="space-y-0">{[...Array(5)].map((_, i) => <div key={i} className="h-14 border-b border-[#1a1a1a] animate-pulse bg-[#111111]/50" />)}</div>
      ) : data?.items.length === 0 ? (
        <div className="text-center text-sm font-mono text-[#666666] py-8">No rankings yet</div>
      ) : (
        <>
          {data?.items.map((entry) => <LeaderboardRow key={entry.userId} entry={entry} isCurrentUser={entry.userId === currentUserId} />)}
          {data && data.total > 25 && (
            <div className="flex items-center justify-center gap-4 mt-4">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="text-xs font-mono text-[#00ff88] disabled:text-[#666666] disabled:cursor-not-allowed">← Prev</button>
              <span className="text-xs font-mono text-[#666666]">Page {data.page} of {Math.ceil(data.total / data.pageSize)}</span>
              <button onClick={() => setPage((p) => p + 1)} disabled={!data.hasMore} className="text-xs font-mono text-[#00ff88] disabled:text-[#666666] disabled:cursor-not-allowed">Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
