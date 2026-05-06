"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Wallet, TrendingUp, TrendingDown, Award, Flame, Target } from "lucide-react";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { userApi } from "@/lib/api";
import { useBalance, useGamification } from "@/stores";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import type { UserProfile } from "@/types";

export default function DashboardPage() {
  const { balance } = useBalance();
  const { loadStats } = useGamification();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const data = await userApi.getProfile();
        setProfile(data);
        loadStats({
          currentStreak: data.currentStreak,
          maxStreak: data.maxStreak,
          totalWins: data.totalWins,
          totalLosses: data.totalLosses,
        });
      } catch (error) {
        console.error("Failed to fetch profile:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchProfile();
  }, [loadStats]);

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-6 max-w-2xl">
        <div className="animate-pulse space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-32 bg-background-card rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  const winRate = profile
    ? profile.totalWins + profile.totalLosses > 0
      ? (profile.totalWins / (profile.totalWins + profile.totalLosses)) * 100
      : 0
    : 0;

  return (
    <div className="container mx-auto px-4 py-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-text-primary mb-6">Dashboard</h1>

      {/* Balance Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0 }}
      >
        <Card className="mb-4 bg-gradient-to-br from-primary-500/20 to-accent-purple/20 border-primary-500/30">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-text-secondary text-sm mb-1">Total Balance</p>
                <p className="text-4xl font-bold text-text-primary">
                  {formatCurrency(balance.totalBalance)}
                </p>
                <div className="flex gap-4 mt-2 text-sm">
                  <span className="text-text-secondary">
                    Available: <span className="text-long">{formatCurrency(balance.availableBalance)}</span>
                  </span>
                  <span className="text-text-secondary">
                    Locked: <span className="text-accent-yellow">{formatCurrency(balance.lockedBalance)}</span>
                  </span>
                </div>
              </div>
              <div className="w-16 h-16 rounded-full bg-primary-500/20 flex items-center justify-center">
                <Wallet className="w-8 h-8 text-primary-400" />
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-lg bg-long/20 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-long" />
                </div>
                <div>
                  <p className="text-text-muted text-xs">Total PnL</p>
                  <p className={`text-xl font-bold ${(profile?.totalPnl || 0) >= 0 ? "text-long" : "text-short"}`}>
                    {formatCurrency(profile?.totalPnl || 0)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-lg bg-accent-purple/20 flex items-center justify-center">
                  <Target className="w-5 h-5 text-accent-purple" />
                </div>
                <div>
                  <p className="text-text-muted text-xs">Win Rate</p>
                  <p className="text-xl font-bold text-text-primary">
                    {formatPercent(winRate).replace("+", "")}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-lg bg-accent-orange/20 flex items-center justify-center">
                  <Flame className="w-5 h-5 text-accent-orange" />
                </div>
                <div>
                  <p className="text-text-muted text-xs">Current Streak</p>
                  <p className="text-xl font-bold text-text-primary">
                    {profile?.currentStreak || 0}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
        >
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-lg bg-accent-yellow/20 flex items-center justify-center">
                  <Award className="w-5 h-5 text-accent-yellow" />
                </div>
                <div>
                  <p className="text-text-muted text-xs">Best Streak</p>
                  <p className="text-xl font-bold text-text-primary">
                    {profile?.maxStreak || 0}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Trades Summary */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <Card>
          <CardHeader>
            <CardTitle>Trading Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-between items-center py-3 border-b border-border">
              <span className="text-text-secondary">Total Trades</span>
              <span className="font-semibold text-text-primary">
                {(profile?.totalWins || 0) + (profile?.totalLosses || 0)}
              </span>
            </div>
            <div className="flex justify-between items-center py-3 border-b border-border">
              <span className="text-text-secondary">Winning Trades</span>
              <span className="font-semibold text-long">{profile?.totalWins || 0}</span>
            </div>
            <div className="flex justify-between items-center py-3">
              <span className="text-text-secondary">Losing Trades</span>
              <span className="font-semibold text-short">{profile?.totalLosses || 0}</span>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
