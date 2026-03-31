'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, getJwt } from '../lib/api';
import { queryKeys } from '../lib/query-keys';
import type { UserProfileFull, ProfileUpdatePayload } from '../types/profile';

export function useMyProfile() {
  const queryClient = useQueryClient();
  const profileQuery = useQuery({
    queryKey: queryKeys.profile.me,
    queryFn: () => api.get<UserProfileFull>('/users/me'),
    enabled: !!getJwt(),
    staleTime: 30_000,
  });
  const updateProfile = useMutation({
    mutationFn: (data: ProfileUpdatePayload) => api.patch<any>('/users/me', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.profile.me });
      queryClient.invalidateQueries({ queryKey: queryKeys.profile.all });
    },
  });
  return { profile: profileQuery.data, isLoading: profileQuery.isLoading, error: profileQuery.error, updateProfile };
}
