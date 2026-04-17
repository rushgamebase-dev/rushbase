'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { UserRank } from '../types/profile';

export function useRank(userId: string | undefined) {
  return useQuery({
    queryKey: userId ? ['rank', userId] : ['rank', 'none'],
    queryFn: () => api.get<UserRank | null>(`/users/${userId}/rank`),
    enabled: !!userId,
    staleTime: 120_000,
  });
}
