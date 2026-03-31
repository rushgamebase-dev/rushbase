import type { LeaderboardType } from '../types/profile';

export const queryKeys = {
  auth: ['auth'] as const,

  profile: {
    all: ['profile'] as const,
    byId: (id: string) => ['profile', id] as const,
    byAddress: (addr: string) => ['profile', 'address', addr.toLowerCase()] as const,
    me: ['profile', 'me'] as const,
  },

  stats: {
    byUser: (userId: string) => ['stats', userId] as const,
  },

  bets: {
    byUser: (userId: string, filters: Record<string, unknown> = {}) =>
      ['bets', userId, filters] as const,
  },

  badges: {
    all: ['badges'] as const,
    byUser: (userId: string) => ['badges', userId] as const,
  },

  leaderboard: {
    byType: (type: LeaderboardType, page: number = 1) =>
      ['leaderboard', type, page] as const,
  },

  handleAvailability: (handle: string) =>
    ['handle-available', handle.toLowerCase()] as const,
};
