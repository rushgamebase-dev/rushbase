'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/query-keys';
import type { UserStats } from '../types/profile';

export function useStats(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.stats.byUser(userId || ''),
    queryFn: () => api.get<UserStats>(`/users/${userId}/stats`),
    enabled: !!userId,
    staleTime: 30_000,
  });
}
