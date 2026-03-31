'use client';

import type { BetHistoryEntry } from '../../types/profile';
import { formatVolume, formatRelativeTime } from '../../lib/format';

interface BetHistoryRowProps {
  bet: BetHistoryEntry;
}

const STATUS_DOT: Record<string, string> = {
  WON: 'bg-[#00ff88]',
  LOST: 'bg-[#ff4444]',
  PENDING: 'bg-[#ffd700]',
  CANCELLED: 'bg-[#666666]',
};

export function BetHistoryRow({ bet }: BetHistoryRowProps) {
  const pnl = bet.pnl ? parseFloat(bet.pnl) : null;

  return (
    <div className="bg-[#111111] border border-[#1a1a1a] rounded-lg p-4 mb-2">
      {/* Row 1: Status + Market + Time */}
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-2 h-2 rounded-full ${STATUS_DOT[bet.outcome]}`} />
        <span className="text-sm font-mono text-[#e0e0e0] truncate flex-1">
          {bet.marketDesc || `Market ${bet.marketAddress.slice(0, 10)}...`}
        </span>
        <span className="text-[10px] font-mono text-[#666666]">
          {formatRelativeTime(bet.placedAt)}
        </span>
      </div>

      {/* Row 2: Position + Amount + Payout + Link */}
      <div className="flex items-center gap-3">
        <span
          className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
            bet.rangeLabel.toLowerCase().includes('over')
              ? 'bg-[#00ff88]/10 text-[#00ff88]'
              : 'bg-[#ff4444]/10 text-[#ff4444]'
          }`}
        >
          {bet.rangeLabel}
        </span>

        <span className="text-sm font-mono text-[#e0e0e0]">
          {formatVolume(bet.amount)}
        </span>

        <span className="text-[#666666]">→</span>

        <span className={`text-sm font-mono font-bold ${
          bet.outcome === 'WON' ? 'text-[#00ff88]' :
          bet.outcome === 'LOST' ? 'text-[#ff4444]' : 'text-[#666666]'
        }`}>
          {bet.claimAmount ? formatVolume(bet.claimAmount) :
           bet.outcome === 'PENDING' ? '...' : '0'}
        </span>

        {pnl !== null && bet.outcome !== 'PENDING' && (
          <span className={`text-[10px] font-mono ${pnl >= 0 ? 'text-[#00ff88]' : 'text-[#ff4444]'}`}>
            ({pnl >= 0 ? '+' : ''}{formatVolume(bet.pnl!)})
          </span>
        )}

        <a
          href={`https://basescan.org/tx/${bet.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-[10px] font-mono text-[#666666] hover:text-[#00ff88] transition-colors"
        >
          ↗
        </a>
      </div>
    </div>
  );
}
