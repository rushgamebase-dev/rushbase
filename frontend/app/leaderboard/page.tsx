"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import Header from "@/components/Header";
import { useLeaderboard, type LeaderboardSort, type LeaderboardRow } from "@/profile-kit/hooks/useLeaderboard";
import { useMyProfile } from "@/profile-kit/hooks/useMyProfile";
import { useRank } from "@/profile-kit/hooks/useRank";
import { IdentityChip } from "@/profile-kit/components/identity/IdentityChip";
import { formatVolume } from "@/profile-kit/lib/format";

function formatPnl(pnlEth: string) {
  const n = parseFloat(pnlEth);
  if (!isFinite(n) || n === 0) return { text: "0 ETH", color: "#888" };
  const abs = Math.abs(n);
  const short = abs >= 1000 ? `${(abs / 1000).toFixed(1)}k` : abs.toFixed(abs >= 1 ? 2 : 4);
  return {
    text: `${n > 0 ? "+" : "-"}${short} ETH`,
    color: n > 0 ? "#00ff88" : "#ff4444",
  };
}

const SORTS: { key: LeaderboardSort; label: string; hint: string }[] = [
  { key: "volume", label: "Volume",  hint: "Total ETH wagered" },
  { key: "pnl",    label: "P&L",     hint: "All-time net profit" },
  { key: "wins",   label: "Wins",    hint: "Total wins" },
  { key: "bets",   label: "Bets",    hint: "Total bets placed" },
];

function StatValue({ sort, row }: { sort: LeaderboardSort; row: LeaderboardRow }) {
  if (sort === "volume") return <span className="font-mono font-bold text-[#e0e0e0]">{formatVolume(row.totalVolume)}</span>;
  if (sort === "pnl") {
    const { text, color } = formatPnl(row.totalPnl);
    return <span className="font-mono font-bold" style={{ color }}>{text}</span>;
  }
  if (sort === "wins") return <span className="font-mono font-bold text-[#e0e0e0]">{row.totalWins.toLocaleString()}</span>;
  return <span className="font-mono font-bold text-[#e0e0e0]">{row.totalBets.toLocaleString()}</span>;
}

function rankColor(rank: number): string {
  if (rank === 1) return "#ffd700";
  if (rank === 2) return "#c0c0c0";
  if (rank === 3) return "#cd7f32";
  return "#555";
}

export default function LeaderboardPage() {
  const [sort, setSort] = useState<LeaderboardSort>("volume");
  const { data, isLoading, error } = useLeaderboard(sort, 50);
  const { profile: me } = useMyProfile();
  const { data: myRank } = useRank(me?.id);

  const myWallet = me?.wallet?.toLowerCase();
  const inTop50 = !!myWallet && data?.some((r) => r.wallet.toLowerCase() === myWallet);
  const myRankForSort = myRank
    ? sort === "volume" ? myRank.volume
    : sort === "pnl" ? myRank.pnl
    : sort === "wins" ? myRank.wins
    : myRank.bets
    : null;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#e0e0e0]">
      <Header />

      <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-5">
        <div className="flex items-center gap-2 text-xs font-mono text-[#555]">
          <Link href="/" className="flex items-center gap-1 hover:text-[#00ff88] transition-colors">
            <ArrowLeft size={12} /> BACK
          </Link>
          <span>/</span>
          <span className="text-[#888]">LEADERBOARD</span>
        </div>

        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl md:text-3xl font-mono font-black uppercase tracking-tight">
            Leaderboard
          </h1>
          <div className="text-[10px] font-mono text-[#666] uppercase tracking-[0.2em]">
            Top 50
          </div>
        </div>

        <div className="flex gap-1 border-b border-[#1a1a1a] overflow-x-auto scrollbar-none">
          {SORTS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSort(s.key)}
              className={`text-xs font-mono px-4 py-2 border-b-2 transition-colors whitespace-nowrap ${
                sort === s.key
                  ? "text-[#00ff88] border-[#00ff88]"
                  : "text-[#666] border-transparent hover:text-[#e0e0e0]"
              }`}
              title={s.hint}
            >
              {s.label}
            </button>
          ))}
        </div>

        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-12 bg-[#0d0d0d] border border-[#1a1a1a] rounded-lg animate-pulse" />
            ))}
          </div>
        )}

        {error && (
          <div className="text-sm font-mono text-[#ff4444] p-4 border border-[#332222] rounded-lg bg-[#1a0f0f]">
            Failed to load leaderboard. Try again in a moment.
          </div>
        )}

        {data && data.length === 0 && (
          <div className="text-center text-sm font-mono text-[#666] py-12">
            No players yet — be first on the board.
          </div>
        )}

        {data && data.length > 0 && (
          <ol className="space-y-1 pb-24">
            {data.map((row) => {
              const isMe = !!myWallet && row.wallet.toLowerCase() === myWallet;
              return (
                <li
                  key={row.userId}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                    isMe
                      ? "border-[#00ff88]/50 bg-[#00ff88]/5 shadow-[0_0_18px_rgba(0,255,136,0.18)]"
                      : "border-[#1a1a1a] bg-[#0d0d0d] hover:border-[#333]"
                  }`}
                >
                  <div
                    className="w-8 text-center font-mono font-black text-sm shrink-0"
                    style={{ color: rankColor(row.rank) }}
                  >
                    #{row.rank}
                  </div>
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <IdentityChip address={row.wallet} size="sm" />
                    {isMe && (
                      <span className="text-[9px] font-mono font-black uppercase tracking-[0.15em] text-[#00ff88] px-1.5 py-0.5 rounded border border-[#00ff88]/40 bg-[#00ff88]/10">
                        You
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-4 text-xs font-mono shrink-0">
                    <div className="hidden sm:block text-right">
                      <div className="text-[#666] text-[10px] uppercase tracking-[0.15em]">
                        Win rate
                      </div>
                      <div className="text-[#aaa]">
                        {(row.winRate * 100).toFixed(0)}%
                      </div>
                    </div>
                    <div className="text-right min-w-[80px]">
                      <div className="text-[#666] text-[10px] uppercase tracking-[0.15em]">
                        {SORTS.find((s) => s.key === sort)?.label}
                      </div>
                      <StatValue sort={sort} row={row} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </main>

      {me && myRankForSort && !inTop50 && (
        <div className="fixed bottom-0 inset-x-0 z-30 pointer-events-none px-4 pb-4">
          <div className="max-w-3xl mx-auto pointer-events-auto">
            <Link
              href={`/profile/${me.wallet}`}
              className="flex items-center gap-3 p-3 rounded-lg border border-[#00ff88]/50 bg-[#0a0a0a]/95 backdrop-blur shadow-[0_-6px_24px_rgba(0,0,0,0.6)] hover:border-[#00ff88] transition-colors"
            >
              <div className="w-8 text-center font-mono font-black text-sm shrink-0 text-[#00ff88]">
                #{myRankForSort.rank}
              </div>
              <div className="flex-1 min-w-0 flex items-center gap-2">
                <IdentityChip address={me.wallet} size="sm" linkTo={false} />
                <span className="text-[9px] font-mono font-black uppercase tracking-[0.15em] text-[#00ff88] px-1.5 py-0.5 rounded border border-[#00ff88]/40 bg-[#00ff88]/10">
                  You
                </span>
              </div>
              <div className="text-right text-xs font-mono shrink-0">
                <div className="text-[#666] text-[10px] uppercase tracking-[0.15em]">
                  Top {myRankForSort.percentile}%
                </div>
                <div className="text-[#00ff88] font-bold">#{myRankForSort.rank}</div>
              </div>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
