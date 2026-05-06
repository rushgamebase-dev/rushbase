"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Trophy, Medal, Award, TrendingUp } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";
import { leaderboardApi } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import type { LeaderboardEntry } from "@/types";

const RANK_ICONS = [Trophy, Medal, Award];
const RANK_COLORS = ["text-accent-yellow", "text-text-secondary", "text-accent-orange"];

export default function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [period, setPeriod] = useState<"daily" | "weekly" | "all_time">("all_time");

  useEffect(() => {
    const fetchLeaderboard = async () => {
      setIsLoading(true);
      try {
        const data = await leaderboardApi.getLeaderboard(period, 100);
        setEntries(data);
      } catch (error) {
        console.error("Failed to fetch leaderboard:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchLeaderboard();
  }, [period]);

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-text-primary mb-6">Leaderboard</h1>

      {/* Period Selector */}
      <div className="flex gap-2 mb-6">
        {(["daily", "weekly", "all_time"] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={cn(
              "flex-1 py-2 rounded-lg font-semibold transition-all text-sm",
              period === p
                ? "bg-primary-500 text-white"
                : "bg-background-secondary text-text-secondary hover:bg-background-elevated"
            )}
          >
            {p === "all_time" ? "All Time" : p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-4">
          {[...Array(10)].map((_, i) => (
            <div key={i} className="h-16 bg-background-card rounded-2xl" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Trophy className="w-12 h-12 text-text-muted mx-auto mb-4" />
            <p className="text-text-secondary">No traders yet</p>
            <p className="text-text-muted text-sm mt-1">Be the first to make it to the leaderboard!</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Top 3 Podium */}
          {entries.length >= 3 && (
            <div className="flex justify-center items-end gap-4 mb-8">
              {/* 2nd Place */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="flex flex-col items-center"
              >
                <div className="w-16 h-16 rounded-full bg-text-secondary/20 flex items-center justify-center mb-2">
                  <Medal className="w-8 h-8 text-text-secondary" />
                </div>
                <p className="font-semibold text-text-primary truncate max-w-20">
                  {entries[1].username}
                </p>
                <p className="text-sm text-long">{formatCurrency(entries[1].totalPnl)}</p>
                <div className="w-20 h-24 bg-text-secondary/20 rounded-t-lg mt-2" />
              </motion.div>

              {/* 1st Place */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0 }}
                className="flex flex-col items-center"
              >
                <div className="w-20 h-20 rounded-full bg-accent-yellow/20 flex items-center justify-center mb-2 ring-4 ring-accent-yellow/30">
                  <Trophy className="w-10 h-10 text-accent-yellow" />
                </div>
                <p className="font-bold text-lg text-text-primary truncate max-w-24">
                  {entries[0].username}
                </p>
                <p className="text-long font-semibold">{formatCurrency(entries[0].totalPnl)}</p>
                <div className="w-24 h-32 bg-accent-yellow/20 rounded-t-lg mt-2" />
              </motion.div>

              {/* 3rd Place */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="flex flex-col items-center"
              >
                <div className="w-16 h-16 rounded-full bg-accent-orange/20 flex items-center justify-center mb-2">
                  <Award className="w-8 h-8 text-accent-orange" />
                </div>
                <p className="font-semibold text-text-primary truncate max-w-20">
                  {entries[2].username}
                </p>
                <p className="text-sm text-long">{formatCurrency(entries[2].totalPnl)}</p>
                <div className="w-20 h-16 bg-accent-orange/20 rounded-t-lg mt-2" />
              </motion.div>
            </div>
          )}

          {/* Full List */}
          <Card>
            <CardHeader>
              <CardTitle>Rankings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {entries.map((entry, index) => {
                const RankIcon = index < 3 ? RANK_ICONS[index] : null;
                const rankColor = index < 3 ? RANK_COLORS[index] : "text-text-muted";

                return (
                  <motion.div
                    key={entry.username}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.03 }}
                    className={cn(
                      "flex items-center justify-between py-3 px-3 rounded-lg transition-colors",
                      index < 3 ? "bg-background-secondary" : "hover:bg-background-secondary"
                    )}
                  >
                    <div className="flex items-center gap-4">
                      <div className={cn("w-8 text-center font-bold", rankColor)}>
                        {RankIcon ? (
                          <RankIcon className="w-5 h-5 mx-auto" />
                        ) : (
                          <span>{entry.rank}</span>
                        )}
                      </div>
                      <div>
                        <p className="font-semibold text-text-primary">{entry.username}</p>
                        <p className="text-xs text-text-muted">
                          {entry.totalTrades} trades • {entry.winRate.toFixed(0)}% win rate
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p
                        className={cn(
                          "font-bold",
                          entry.totalPnl >= 0 ? "text-long" : "text-short"
                        )}
                      >
                        {entry.totalPnl >= 0 ? "+" : ""}{formatCurrency(entry.totalPnl)}
                      </p>
                    </div>
                  </motion.div>
                );
              })}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
