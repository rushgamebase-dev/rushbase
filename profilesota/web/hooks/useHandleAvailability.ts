'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/query-keys';

export function useHandleAvailability(handle: string) {
  const normalized = handle.trim().toLowerCase();
  const query = useQuery({
    queryKey: queryKeys.handleAvailability(normalized),
    queryFn: async () => {
      const result = await api.get<{ handle: string; available: boolean }>(`/users/me/check-handle?handle=${encodeURIComponent(normalized)}`);
      return result.available;
    },
    enabled: normalized.length >= 3,
    staleTime: 10_000,
  });
  return { isAvailable: query.data, isChecking: query.isFetching };
}
