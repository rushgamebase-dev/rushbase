"use client";

import { motion } from "framer-motion";
import { Trophy, Medal, TrendingUp, Crown, ChevronRight } from "lucide-react";

// =============================================================================
// LEADERBOARD PREVIEW - Mini Leaderboard Display
// =============================================================================

interface LeaderboardEntry {
  rank: number;
  username: string;
  avatar?: string;
  pnl: number;
  winRate: number;
  level: number;
}

interface LeaderboardPreviewProps {
  entries: LeaderboardEntry[];
  currentUserRank?: number;
  className?: string;
  onViewAll?: () => void;
}

const MOCK_ENTRIES: LeaderboardEntry[] = [
  { rank: 1, username: "WhaleTrader", pnl: 15420.50, winRate: 72.5, level: 15 },
  { rank: 2, username: "CryptoKing", pnl: 12350.00, winRate: 68.3, level: 14 },
  { rank: 3, username: "DiamondHands", pnl: 9870.25, winRate: 65.1, level: 12 },
  { rank: 4, username: "TradeMaster", pnl: 7650.00, winRate: 62.8, level: 11 },
  { rank: 5, username: "BullRunner", pnl: 6200.75, winRate: 60.2, level: 10 },
];

// TAPTRADER - Rank icons
function getRankIcon(rank: number) {
  if (rank === 1) return <Crown className="w-5 h-5 text-neon" style={{ filter: 'drop-shadow(0 0 4px rgba(0, 255, 65, 0.6))' }} />;
  if (rank === 2) return <Medal className="w-5 h-5 text-neon-300" />;
  if (rank === 3) return <Medal className="w-5 h-5 text-neon-400" />;
  return <span className="w-5 h-5 text-center text-sm font-bold text-text-muted font-mono">#{rank}</span>;
}

// TAPTRADER - Rank styles
function getRankStyle(rank: number) {
  if (rank === 1) return "bg-neon/10 border-border-neon";
  if (rank === 2) return "bg-neon/5 border-neon/30";
  if (rank === 3) return "bg-background-card border-border";
  return "bg-background border-border";
}

// TAPTRADER THEME - Leaderboard Preview
export function LeaderboardPreview({
  entries = MOCK_ENTRIES,
  currentUserRank,
  className = "",
  onViewAll,
}: LeaderboardPreviewProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded bg-background-card border border-border overflow-hidden font-mono ${className}`}
    >
      {/* Header - TAPTRADER */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-neon/5">
        <div className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-neon" />
          <h3 className="font-bold text-neon">Leaderboard</h3>
        </div>
        {currentUserRank && (
          <div className="flex items-center gap-1 px-2 py-1 rounded bg-neon/10 border border-border-neon">
            <span className="text-xs text-neon-300">Your Rank:</span>
            <span className="text-sm font-bold text-neon">#{currentUserRank}</span>
          </div>
        )}
      </div>

      {/* Entries - TAPTRADER */}
      <div className="divide-y divide-border">
        {entries.slice(0, 5).map((entry, i) => (
          <motion.div
            key={entry.rank}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            className={`flex items-center gap-3 px-4 py-3 border-l-2 ${getRankStyle(entry.rank)}`}
          >
            {/* Rank */}
            <div className="flex items-center justify-center w-8">
              {getRankIcon(entry.rank)}
            </div>

            {/* Avatar & Username */}
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div
                className="w-8 h-8 rounded flex items-center justify-center text-background font-bold text-sm"
                style={{
                  background: entry.rank === 1 ? '#00ff41' : entry.rank === 2 ? '#00cc33' : entry.rank === 3 ? '#33ff66' : '#666666',
                  boxShadow: entry.rank <= 3 ? '0 0 8px rgba(0, 255, 65, 0.4)' : 'none',
                }}
              >
                {entry.username.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`font-semibold text-sm truncate ${entry.rank === 1 ? 'text-neon' : 'text-text-white'}`}>{entry.username}</p>
                <p className="text-xs text-text-muted">Lv.{entry.level}</p>
              </div>
            </div>

            {/* Stats */}
            <div className="text-right">
              <p className={`font-bold text-sm ${entry.pnl >= 0 ? "text-neon" : "text-short"}`}>
                {entry.pnl >= 0 ? "+" : ""}${entry.pnl.toLocaleString()}
              </p>
              <p className="text-xs text-text-muted">{entry.winRate}% WR</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* View All Button - TAPTRADER */}
      {onViewAll && (
        <button
          onClick={onViewAll}
          className="w-full flex items-center justify-center gap-1 px-4 py-3 text-sm text-neon hover:text-neon-300 hover:bg-neon/10 transition-all border-t border-border"
        >
          [ View Full Leaderboard ]
          <ChevronRight className="w-4 h-4" />
        </button>
      )}
    </motion.div>
  );
}

// =============================================================================
// MINI LEADERBOARD - TAPTRADER THEME - Ultra compact version
// =============================================================================

interface MiniLeaderboardProps {
  entries: LeaderboardEntry[];
  className?: string;
}

export function MiniLeaderboard({ entries = MOCK_ENTRIES.slice(0, 3), className = "" }: MiniLeaderboardProps) {
  return (
    <div className={`flex items-center gap-2 font-mono ${className}`}>
      <Trophy className="w-4 h-4 text-neon" />
      <div className="flex -space-x-2">
        {entries.map((entry) => (
          <motion.div
            key={entry.rank}
            whileHover={{ scale: 1.1, zIndex: 10 }}
            className="relative w-8 h-8 rounded border-2 border-background flex items-center justify-center text-background font-bold text-xs cursor-pointer"
            style={{
              background: entry.rank === 1 ? '#00ff41' : entry.rank === 2 ? '#00cc33' : '#33ff66',
              boxShadow: '0 0 8px rgba(0, 255, 65, 0.4)',
            }}
            title={`#${entry.rank} ${entry.username}`}
          >
            {entry.username.charAt(0)}
            {entry.rank <= 3 && (
              <div className="absolute -top-1 -right-1 w-4 h-4 rounded bg-background flex items-center justify-center">
                {entry.rank === 1 && <Crown className="w-3 h-3 text-neon" />}
                {entry.rank === 2 && <Medal className="w-3 h-3 text-neon-300" />}
                {entry.rank === 3 && <Medal className="w-3 h-3 text-neon-400" />}
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// YOUR RANK BADGE - TAPTRADER THEME - Show current user's rank
// =============================================================================

interface YourRankBadgeProps {
  rank: number;
  totalUsers: number;
  pnl: number;
  className?: string;
}

export function YourRankBadge({ rank, totalUsers, pnl, className = "" }: YourRankBadgeProps) {
  const percentile = Math.round((1 - rank / totalUsers) * 100);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`flex items-center gap-3 px-4 py-2 rounded bg-neon/10 border border-border-neon font-mono ${className}`}
    >
      <div className="flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-neon" />
        <span className="text-sm text-text-muted">Your Rank</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xl font-bold text-neon">#{rank}</span>
        <span className="text-xs text-text-muted">/ {totalUsers}</span>
      </div>
      <div className="ml-auto">
        <span className="text-xs text-neon-300">Top {percentile}%</span>
      </div>
    </motion.div>
  );
}
