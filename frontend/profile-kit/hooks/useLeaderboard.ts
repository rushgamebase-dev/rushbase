'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export type LeaderboardSort = 'volume' | 'pnl' | 'wins' | 'bets';

export interface LeaderboardRow {
  rank: number;
  userId: string;
  wallet: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  totalBets: number;
  totalWins: number;
  totalLosses: number;
  totalVolume: string;
  totalPnl: string;
  winRate: number;
  bestStreak: number;
  xp: number;
}

export function useLeaderboard(sort: LeaderboardSort = 'volume', limit = 50) {
  return useQuery({
    queryKey: ['leaderboard', sort, limit],
    queryFn: () => api.get<LeaderboardRow[]>(`/leaderboard?sort=${sort}&limit=${limit}`),
    staleTime: 60_000,
  });
}
