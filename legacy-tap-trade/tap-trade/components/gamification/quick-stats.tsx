"use client";

import { motion } from "framer-motion";
import {
  TrendingUp,
  TrendingDown,
  Target,
  Zap,
  DollarSign,
  BarChart3,
  Clock,
  Award,
} from "lucide-react";
import { AnimatedNumber, AnimatedWinRate } from "./animated-number";

// =============================================================================
// QUICK STATS PANEL - Compact Session Statistics
// =============================================================================

interface QuickStatsProps {
  totalBets: number;
  wins: number;
  losses: number;
  netPnL: number;
  balance: number;
  streak: number;
  className?: string;
  layout?: "horizontal" | "vertical" | "grid";
}

export function QuickStats({
  totalBets,
  wins,
  losses,
  netPnL,
  balance,
  streak,
  className = "",
  layout = "horizontal",
}: QuickStatsProps) {
  const winRate = totalBets > 0 ? (wins / totalBets) * 100 : 0;

  const stats = [
    {
      label: "Balance",
      value: balance,
      format: "currency" as const,
      icon: DollarSign,
      color: "text-green-400",
      bgColor: "bg-green-500/10",
    },
    {
      label: "P&L",
      value: netPnL,
      format: "pnl" as const,
      icon: netPnL >= 0 ? TrendingUp : TrendingDown,
      color: netPnL >= 0 ? "text-green-400" : "text-red-400",
      bgColor: netPnL >= 0 ? "bg-green-500/10" : "bg-red-500/10",
    },
    {
      label: "Win Rate",
      value: winRate,
      format: "percent" as const,
      icon: Target,
      color: winRate >= 50 ? "text-green-400" : "text-yellow-400",
      bgColor: winRate >= 50 ? "bg-green-500/10" : "bg-yellow-500/10",
    },
    {
      label: "Streak",
      value: streak,
      format: "number" as const,
      icon: Zap,
      color: streak >= 3 ? "text-orange-400" : "text-gray-400",
      bgColor: streak >= 3 ? "bg-orange-500/10" : "bg-gray-500/10",
    },
  ];

  if (layout === "horizontal") {
    return (
      <div className={`flex items-center gap-4 ${className}`}>
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="flex items-center gap-2"
          >
            <div className={`p-1.5 rounded-lg ${stat.bgColor}`}>
              <stat.icon className={`w-4 h-4 ${stat.color}`} />
            </div>
            <div>
              <p className="text-xs text-gray-500">{stat.label}</p>
              {stat.format === "pnl" ? (
                <span className={`font-bold ${stat.color}`}>
                  {stat.value >= 0 ? "+" : ""}{stat.value.toFixed(2)}
                </span>
              ) : stat.format === "currency" ? (
                <AnimatedNumber value={stat.value} format="currency" size="sm" />
              ) : stat.format === "percent" ? (
                <span className={`font-bold ${stat.color}`}>
                  {stat.value.toFixed(1)}%
                </span>
              ) : (
                <span className={`font-bold ${stat.color}`}>{stat.value}</span>
              )}
            </div>
          </motion.div>
        ))}
      </div>
    );
  }

  if (layout === "grid") {
    return (
      <div className={`grid grid-cols-2 gap-2 ${className}`}>
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.05 }}
            className={`p-3 rounded-xl ${stat.bgColor} border border-gray-800`}
          >
            <div className="flex items-center gap-2 mb-1">
              <stat.icon className={`w-4 h-4 ${stat.color}`} />
              <span className="text-xs text-gray-400">{stat.label}</span>
            </div>
            {stat.format === "pnl" ? (
              <span className={`text-lg font-bold ${stat.color}`}>
                {stat.value >= 0 ? "+" : ""}${Math.abs(stat.value).toFixed(2)}
              </span>
            ) : stat.format === "currency" ? (
              <AnimatedNumber value={stat.value} format="currency" size="lg" />
            ) : stat.format === "percent" ? (
              <span className={`text-lg font-bold ${stat.color}`}>
                {stat.value.toFixed(1)}%
              </span>
            ) : (
              <span className={`text-lg font-bold ${stat.color}`}>{stat.value}</span>
            )}
          </motion.div>
        ))}
      </div>
    );
  }

  // Vertical layout
  return (
    <div className={`space-y-2 ${className}`}>
      {stats.map((stat, i) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.05 }}
          className="flex items-center justify-between p-2 rounded-lg bg-gray-800/50"
        >
          <div className="flex items-center gap-2">
            <stat.icon className={`w-4 h-4 ${stat.color}`} />
            <span className="text-sm text-gray-400">{stat.label}</span>
          </div>
          {stat.format === "pnl" ? (
            <span className={`font-bold ${stat.color}`}>
              {stat.value >= 0 ? "+" : ""}${Math.abs(stat.value).toFixed(2)}
            </span>
          ) : stat.format === "currency" ? (
            <AnimatedNumber value={stat.value} format="currency" size="sm" />
          ) : stat.format === "percent" ? (
            <span className={`font-bold ${stat.color}`}>
              {stat.value.toFixed(1)}%
            </span>
          ) : (
            <span className={`font-bold ${stat.color}`}>{stat.value}</span>
          )}
        </motion.div>
      ))}
    </div>
  );
}

// =============================================================================
// SESSION SUMMARY - Detailed session overview
// =============================================================================

interface SessionSummaryProps {
  startTime: number;
  totalBets: number;
  wins: number;
  losses: number;
  netPnL: number;
  biggestWin: number;
  biggestLoss: number;
  xpEarned: number;
  className?: string;
}

export function SessionSummary({
  startTime,
  totalBets,
  wins,
  losses,
  netPnL,
  biggestWin,
  biggestLoss,
  xpEarned,
  className = "",
}: SessionSummaryProps) {
  const duration = Date.now() - startTime;
  const minutes = Math.floor(duration / 60000);
  const seconds = Math.floor((duration % 60000) / 1000);
  const winRate = totalBets > 0 ? (wins / totalBets) * 100 : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`p-4 rounded-2xl bg-gradient-to-br from-gray-900 to-gray-800 border border-gray-700 ${className}`}
    >
      <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        <BarChart3 className="w-5 h-5 text-purple-400" />
        Session Summary
      </h3>

      <div className="grid grid-cols-2 gap-3">
        {/* Duration */}
        <div className="p-3 rounded-xl bg-gray-800/50">
          <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
            <Clock className="w-3 h-3" />
            Duration
          </div>
          <p className="font-bold text-white">
            {minutes}m {seconds}s
          </p>
        </div>

        {/* Win Rate Circle */}
        <div className="p-3 rounded-xl bg-gray-800/50">
          <AnimatedWinRate wins={wins} total={totalBets} />
        </div>

        {/* Trades */}
        <div className="p-3 rounded-xl bg-gray-800/50">
          <p className="text-gray-400 text-xs mb-1">Total Trades</p>
          <div className="flex items-center gap-2">
            <span className="font-bold text-white text-lg">{totalBets}</span>
            <span className="text-xs text-green-400">+{wins}</span>
            <span className="text-xs text-red-400">-{losses}</span>
          </div>
        </div>

        {/* Net P&L */}
        <div className="p-3 rounded-xl bg-gray-800/50">
          <p className="text-gray-400 text-xs mb-1">Net P&L</p>
          <p className={`font-bold text-lg ${netPnL >= 0 ? "text-green-400" : "text-red-400"}`}>
            {netPnL >= 0 ? "+" : ""}${netPnL.toFixed(2)}
          </p>
        </div>

        {/* Best Trade */}
        <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/30">
          <p className="text-green-400 text-xs mb-1">Best Trade</p>
          <p className="font-bold text-green-400">+${biggestWin.toFixed(2)}</p>
        </div>

        {/* Worst Trade */}
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30">
          <p className="text-red-400 text-xs mb-1">Worst Trade</p>
          <p className="font-bold text-red-400">-${biggestLoss.toFixed(2)}</p>
        </div>
      </div>

      {/* XP Earned */}
      <motion.div
        className="mt-4 p-3 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-between"
        animate={{
          boxShadow: [
            "0 0 10px rgba(168, 85, 247, 0.2)",
            "0 0 20px rgba(168, 85, 247, 0.3)",
            "0 0 10px rgba(168, 85, 247, 0.2)",
          ],
        }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        <div className="flex items-center gap-2">
          <Award className="w-5 h-5 text-purple-400" />
          <span className="text-purple-300 font-semibold">XP Earned</span>
        </div>
        <span className="text-xl font-bold text-purple-300">+{xpEarned}</span>
      </motion.div>
    </motion.div>
  );
}

// =============================================================================
// MINI STATS BAR - Ultra compact for inline use
// =============================================================================

interface MiniStatsBarProps {
  wins: number;
  losses: number;
  pnl: number;
  className?: string;
}

export function MiniStatsBar({ wins, losses, pnl, className = "" }: MiniStatsBarProps) {
  return (
    <div className={`flex items-center gap-3 text-xs ${className}`}>
      <span className="flex items-center gap-1">
        <TrendingUp className="w-3 h-3 text-green-400" />
        <span className="text-green-400 font-medium">{wins}</span>
      </span>
      <span className="flex items-center gap-1">
        <TrendingDown className="w-3 h-3 text-red-400" />
        <span className="text-red-400 font-medium">{losses}</span>
      </span>
      <span className={`font-bold ${pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
        {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
      </span>
    </div>
  );
}
