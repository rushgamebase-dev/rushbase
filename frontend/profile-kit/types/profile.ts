export type Address = `0x${string}`;

export interface UserProfile {
  id: string;
  wallet: Address;
  createdAt: string;
  profile: {
    handle: string | null;
    displayName: string | null;
    bio: string | null;
    avatarUrl: string | null;
    isPublic: boolean;
  } | null;
  stats: UserStats | null;
  badges: BadgeEarned[];
}

export interface UserProfileFull extends UserProfile {
  lastSeenAt: string | null;
}

export interface UserStats {
  totalBets: number;
  totalWins: number;
  totalLosses: number;
  winRate: number;
  totalVolume: string;
  totalPnl: string;
  biggestWin: string;
  currentStreak: number;
  bestStreak: number;
  xp: number;
  level: number;
  xpToNextLevel?: number;
}

export interface BadgeDefinition {
  id: string;
  slug: string;
  name: string;
  description: string;
  imageUrl: string | null;
}

export interface BadgeEarned {
  slug: string;
  name: string;
  description?: string;
  imageUrl: string | null;
  earnedAt: string | null;
  displayed?: boolean;
  isEarned?: boolean;
}

export type BetOutcome = 'PENDING' | 'WON' | 'LOST' | 'CANCELLED';

export interface BetHistoryEntry {
  id: string;
  marketAddress: string;
  marketDesc: string | null;
  rangeIndex: number;
  rangeLabel: string;
  amount: string;
  txHash: string;
  outcome: BetOutcome;
  claimAmount: string | null;
  pnl: string | null;
  placedAt: string;
  resolvedAt: string | null;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface ProfileCardData {
  id: string;
  wallet: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  level: number;
  xp: number;
  xpToNextLevel: number;
  totalBets: number;
  totalVolume: string;
  totalPnl: string;
  winRate: number;
  bestStreak: number;
  badges: Array<{ slug: string; name: string; imageUrl: string | null }>;
  joinedAt: string;
}

export interface MiniProfile {
  id: string;
  wallet: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  level: number;
  badges: Array<{ slug: string; name: string }>;
}

export interface ProfileUpdatePayload {
  handle?: string;
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
  isPublic?: boolean;
}
