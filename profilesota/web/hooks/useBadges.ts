'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/query-keys';
import type { BadgeEarned } from '../types/profile';

export function useBadges(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.badges.byUser(userId || ''),
    queryFn: () => api.get<BadgeEarned[]>(`/users/${userId}/badges`),
    enabled: !!userId,
    staleTime: 60_000,
  });
}
