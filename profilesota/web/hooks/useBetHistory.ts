'use client';

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/query-keys';
import type { BetHistoryEntry, PaginatedResponse } from '../types/profile';

export function useBetHistory(
  userId: string | undefined,
  options: { page?: number; pageSize?: number; status?: string } = {},
) {
  const { page = 1, pageSize = 20, status } = options;

  return useQuery({
    queryKey: queryKeys.bets.byUser(userId || '', { page, pageSize, status }),
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('page', page.toString());
      params.set('pageSize', pageSize.toString());
      if (status && status !== 'all') params.set('status', status);
      return api.get<PaginatedResponse<BetHistoryEntry>>(
        `/users/${userId}/bets?${params}`,
      );
    },
    enabled: !!userId,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
}
