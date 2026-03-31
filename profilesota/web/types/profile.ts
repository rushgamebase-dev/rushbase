export type Address = `0x${string}`;

// ─── User Profile ────────────────────────────────────────────────────────────

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
  labels: UserLabelData[];
  badges: BadgeEarned[];
}

export interface UserProfileFull extends UserProfile {
  lastSeenAt: string | null;
  settings: UserSettings | null;
}

// ─── Stats ───────────────────────────────────────────────────────────────────

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
  marketsParticipated: number;
  xp: number;
  level: number;
  xpToNextLevel?: number;
}

// ─── Badges ──────────────────────────────────────────────────────────────────

export type BadgeRarity = 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';
export type BadgeCategory = 'MILESTONE' | 'STREAK' | 'VOLUME' | 'SPECIAL' | 'MANUAL';

export interface BadgeDefinition {
  id: string;
  slug: string;
  name: string;
  description: string;
  imageUrl: string | null;
  category: BadgeCategory;
  rarity: BadgeRarity;
  sortOrder: number;
}

export interface BadgeEarned {
  slug: string;
  name: string;
  description?: string;
  imageUrl: string | null;
  rarity: BadgeRarity;
  category?: BadgeCategory;
  earnedAt: string | null;
  displayed?: boolean;
  isEarned?: boolean;
}

// ─── Labels ──────────────────────────────────────────────────────────────────

export type LabelType = 'admin' | 'mod' | 'whale' | 'beta_tester' | 'verified' | 'founder' | 'early_player';

export interface UserLabelData {
  label: string;
  color: string | null;
  icon: string | null;
}

// ─── Bets ────────────────────────────────────────────────────────────────────

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
  actualCount: number | null;
  threshold: number | null;
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

// ─── Leaderboard ─────────────────────────────────────────────────────────────

export type LeaderboardType = 'volume' | 'pnl' | 'wins' | 'streak';

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  wallet: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  level: number;
  value: string;
  labels: UserLabelData[];
}

// ─── Card ────────────────────────────────────────────────────────────────────

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
  labels: UserLabelData[];
  badges: Array<{ slug: string; name: string; rarity: BadgeRarity; imageUrl: string | null }>;
  joinedAt: string;
}

// ─── Mini Profile (batch/chat) ───────────────────────────────────────────────

export interface MiniProfile {
  id: string;
  wallet: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  level: number;
  labels: UserLabelData[];
  badges: Array<{ slug: string; name: string; rarity: BadgeRarity }>;
}

// ─── Settings ────────────────────────────────────────────────────────────────

export interface UserSettings {
  chatColor: string | null;
  showStats: boolean;
  showBetHistory: boolean;
}

// ─── Profile Update ──────────────────────────────────────────────────────────

export interface ProfileUpdatePayload {
  handle?: string;
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
  isPublic?: boolean;
}
