'use client';

import { useState } from 'react';
import { useBetHistory } from '../../hooks/useBetHistory';
import { BetHistoryRow } from './BetHistoryRow';

const FILTERS = ['all', 'WON', 'LOST', 'PENDING', 'CANCELLED'] as const;

export function BetHistory({ userId, pageSize = 20 }: { userId: string; pageSize?: number }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>('all');
  const { data, isLoading } = useBetHistory(userId, { page, pageSize, status });

  return (
    <div>
      <div className="flex gap-2 mb-4">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => { setStatus(f); setPage(1); }}
            className={`text-[10px] font-mono px-2.5 py-1 rounded-full border transition-colors ${status === f ? 'bg-[#00ff88]/10 text-[#00ff88] border-[#00ff88]/30' : 'text-[#666666] border-[#1a1a1a] hover:border-[#666666]'}`}>
            {f === 'all' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}
          </button>
        ))}
      </div>
      {isLoading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="bg-[#111111] border border-[#1a1a1a] rounded-lg p-4 animate-pulse h-20" />)}</div>
      ) : data?.items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 px-4 border border-dashed border-[#1a1a1a] rounded-xl">
          <div className="text-3xl mb-2">🎯</div>
          <div className="text-sm font-mono text-[#aaa] mb-1">
            {status === 'all' ? 'No bets yet' : `No ${status.toLowerCase()} bets`}
          </div>
          <div className="text-[11px] font-mono text-[#666] mb-4 text-center">
            {status === 'all' ? 'Your first prediction starts the scoreboard.' : 'Switch filter to see everything.'}
          </div>
          {status === 'all' && (
            <a
              href="/"
              className="text-[11px] font-mono font-bold uppercase tracking-wider px-4 py-2 rounded-full bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/40 hover:bg-[#00ff88]/20 transition-colors"
            >
              Place your first bet →
            </a>
          )}
        </div>
      ) : (
        <>
          {data?.items.map((bet) => <BetHistoryRow key={bet.id} bet={bet} />)}
          {data && data.total > pageSize && (
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
