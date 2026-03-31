'use client';

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/query-keys';
import type { LeaderboardType, LeaderboardEntry, PaginatedResponse } from '../types/profile';

interface LeaderboardResponse extends PaginatedResponse<LeaderboardEntry> {
  category: string;
  updatedAt: string;
}

export function useLeaderboard(type: LeaderboardType = 'volume', page: number = 1) {
  return useQuery({
    queryKey: queryKeys.leaderboard.byType(type, page),
    queryFn: () =>
      api.get<LeaderboardResponse>(`/leaderboard/${type}?page=${page}&pageSize=25`),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}
