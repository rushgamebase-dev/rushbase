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

function getRankIcon(rank: number) {
  if (rank === 1) return <Crown className="w-5 h-5 text-yellow-400" />;
  if (rank === 2) return <Medal className="w-5 h-5 text-gray-300" />;
  if (rank === 3) return <Medal className="w-5 h-5 text-amber-600" />;
  return <span className="w-5 h-5 text-center text-sm font-bold text-gray-500">#{rank}</span>;
}

function getRankStyle(rank: number) {
  if (rank === 1) return "bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border-yellow-500/30";
  if (rank === 2) return "bg-gradient-to-r from-gray-400/10 to-gray-500/10 border-gray-400/30";
  if (rank === 3) return "bg-gradient-to-r from-amber-600/10 to-orange-600/10 border-amber-600/30";
  return "bg-gray-800/50 border-gray-700";
}

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
      className={`rounded-2xl bg-gray-900/80 border border-gray-800 overflow-hidden ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gradient-to-r from-purple-900/30 to-pink-900/30">
        <div className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-yellow-400" />
          <h3 className="font-bold text-white">Leaderboard</h3>
        </div>
        {currentUserRank && (
          <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-purple-500/20 border border-purple-500/30">
            <span className="text-xs text-purple-300">Your Rank:</span>
            <span className="text-sm font-bold text-purple-200">#{currentUserRank}</span>
          </div>
        )}
      </div>

      {/* Entries */}
      <div className="divide-y divide-gray-800">
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
                className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm"
                style={{
                  background: `linear-gradient(135deg,
                    hsl(${(entry.username.charCodeAt(0) * 10) % 360}, 70%, 50%),
                    hsl(${(entry.username.charCodeAt(0) * 10 + 60) % 360}, 70%, 40%))`,
                }}
              >
                {entry.username.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white text-sm truncate">{entry.username}</p>
                <p className="text-xs text-gray-500">Lv.{entry.level}</p>
              </div>
            </div>

            {/* Stats */}
            <div className="text-right">
              <p className={`font-bold text-sm ${entry.pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                {entry.pnl >= 0 ? "+" : ""}${entry.pnl.toLocaleString()}
              </p>
              <p className="text-xs text-gray-500">{entry.winRate}% WR</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* View All Button */}
      {onViewAll && (
        <button
          onClick={onViewAll}
          className="w-full flex items-center justify-center gap-1 px-4 py-3 text-sm text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 transition-all border-t border-gray-800"
        >
          View Full Leaderboard
          <ChevronRight className="w-4 h-4" />
        </button>
      )}
    </motion.div>
  );
}

// =============================================================================
// MINI LEADERBOARD - Ultra compact version
// =============================================================================

interface MiniLeaderboardProps {
  entries: LeaderboardEntry[];
  className?: string;
}

export function MiniLeaderboard({ entries = MOCK_ENTRIES.slice(0, 3), className = "" }: MiniLeaderboardProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Trophy className="w-4 h-4 text-yellow-400" />
      <div className="flex -space-x-2">
        {entries.map((entry) => (
          <motion.div
            key={entry.rank}
            whileHover={{ scale: 1.1, zIndex: 10 }}
            className="relative w-8 h-8 rounded-full border-2 border-gray-900 flex items-center justify-center text-white font-bold text-xs cursor-pointer"
            style={{
              background: `linear-gradient(135deg,
                hsl(${(entry.username.charCodeAt(0) * 10) % 360}, 70%, 50%),
                hsl(${(entry.username.charCodeAt(0) * 10 + 60) % 360}, 70%, 40%))`,
            }}
            title={`#${entry.rank} ${entry.username}`}
          >
            {entry.username.charAt(0)}
            {entry.rank <= 3 && (
              <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-gray-900 flex items-center justify-center">
                {entry.rank === 1 && <Crown className="w-3 h-3 text-yellow-400" />}
                {entry.rank === 2 && <Medal className="w-3 h-3 text-gray-300" />}
                {entry.rank === 3 && <Medal className="w-3 h-3 text-amber-600" />}
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// YOUR RANK BADGE - Show current user's rank
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
      className={`flex items-center gap-3 px-4 py-2 rounded-xl bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-500/30 ${className}`}
    >
      <div className="flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-purple-400" />
        <span className="text-sm text-gray-400">Your Rank</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xl font-bold text-white">#{rank}</span>
        <span className="text-xs text-gray-500">/ {totalUsers}</span>
      </div>
      <div className="ml-auto">
        <span className="text-xs text-purple-300">Top {percentile}%</span>
      </div>
    </motion.div>
  );
}
