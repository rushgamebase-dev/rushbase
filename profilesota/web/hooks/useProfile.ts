'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { queryKeys } from '../lib/query-keys';
import type { UserProfile } from '../types/profile';

/**
 * Fetch any user's public profile by handle or address.
 * Uses 60s staleTime — profiles rarely change mid-session.
 */
export function useProfile(identifier: string | undefined) {
  return useQuery({
    queryKey: identifier
      ? identifier.startsWith('0x')
        ? queryKeys.profile.byAddress(identifier)
        : queryKeys.profile.byId(identifier)
      : ['profile', 'none'],
    queryFn: async () => {
      if (!identifier) return null;

      const path = identifier.startsWith('0x')
        ? `/users/address/${identifier}`
        : `/users/${identifier}`;

      return api.get<UserProfile>(path);
    },
    enabled: !!identifier,
    staleTime: 60_000,
  });
}
