// ============================================
// PROFILE TYPES
// ============================================

export interface UserProfile {
  address: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null; // Data URL (base64) for persistence
  createdAt: number;
  updatedAt: number;
}

export interface UpdateProfileDto {
  address: string;
  displayName?: string;
  bio?: string;
  signature: string;
  nonce: string;
}

export interface ProfilesData {
  [address: string]: UserProfile;
}

// Validation constants
export const PROFILE_CONSTRAINTS = {
  DISPLAY_NAME_MIN: 3,
  DISPLAY_NAME_MAX: 20,
  BIO_MAX: 140,
  AVATAR_MAX_SIZE: 2 * 1024 * 1024, // 2MB
  AVATAR_DIMENSIONS: 200,
  ALLOWED_MIME_TYPES: ['image/png', 'image/jpeg', 'image/webp'],
};
