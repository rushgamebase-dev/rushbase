// ============================================
// PROFILE SERVICE - Manages user profiles with Redis persistence
// ============================================

import { Injectable, Logger, OnModuleInit, BadRequestException } from '@nestjs/common';
import Redis from 'ioredis';
import { randomBytes } from 'crypto';
import { UserProfile, ProfilesData, UpdateProfileDto, PROFILE_CONSTRAINTS } from './types';

const REDIS_KEY = 'rushroyale:profiles';
const NONCE_PREFIX = 'rushroyale:nonce:';
const NONCE_TTL = 300; // 5 minutes

@Injectable()
export class ProfileService implements OnModuleInit {
  private readonly logger = new Logger(ProfileService.name);
  private redis: Redis | null = null;

  // In-memory cache
  private profiles: ProfilesData = {};

  async onModuleInit() {
    await this.connectRedis();
    await this.loadProfiles();
    this.logger.log(`ProfileService initialized with ${Object.keys(this.profiles).length} profiles`);
  }

  private async connectRedis(): Promise<void> {
    const redisUrl = process.env.REDIS_URL;

    if (!redisUrl) {
      this.logger.warn('REDIS_URL not set - profiles will not persist across restarts!');
      return;
    }

    try {
      this.redis = new Redis(redisUrl);
      this.redis.on('error', (err) => {
        this.logger.error('Redis connection error:', err);
      });
      this.logger.log('Connected to Redis');
    } catch (error) {
      this.logger.error('Failed to connect to Redis:', error);
    }
  }

  private async loadProfiles(): Promise<void> {
    try {
      if (this.redis) {
        const data = await this.redis.get(REDIS_KEY);
        if (data) {
          this.profiles = JSON.parse(data);
          this.logger.log(`Loaded ${Object.keys(this.profiles).length} profiles from Redis`);
        } else {
          this.profiles = {};
        }
      } else {
        this.profiles = {};
      }
    } catch (error) {
      this.logger.error('Failed to load profiles from Redis:', error);
      this.profiles = {};
    }
  }

  private async saveProfiles(): Promise<void> {
    try {
      if (this.redis) {
        await this.redis.set(REDIS_KEY, JSON.stringify(this.profiles));
      }
    } catch (error) {
      this.logger.error('Failed to save profiles to Redis:', error);
    }
  }

  // ============================================
  // NONCE MANAGEMENT
  // ============================================

  async generateNonce(address: string): Promise<string> {
    const nonce = randomBytes(16).toString('hex');
    const key = `${NONCE_PREFIX}${address.toLowerCase()}`;

    if (this.redis) {
      await this.redis.set(key, nonce, 'EX', NONCE_TTL);
    } else {
      // Fallback: store in memory (not ideal, but allows local dev without Redis)
      (this as any)._nonces = (this as any)._nonces || {};
      (this as any)._nonces[key] = { nonce, expires: Date.now() + NONCE_TTL * 1000 };
    }

    return nonce;
  }

  async consumeNonce(address: string, nonce: string): Promise<boolean> {
    const key = `${NONCE_PREFIX}${address.toLowerCase()}`;

    if (this.redis) {
      const stored = await this.redis.get(key);
      if (!stored || stored !== nonce) return false;
      await this.redis.del(key);
      return true;
    } else {
      // Fallback: memory
      const store = (this as any)._nonces || {};
      const entry = store[key];
      if (!entry || entry.nonce !== nonce || entry.expires < Date.now()) return false;
      delete store[key];
      return true;
    }
  }

  // ============================================
  // PUBLIC METHODS
  // ============================================

  getProfile(address: string): UserProfile | null {
    const normalizedAddress = address.toLowerCase();
    return this.profiles[normalizedAddress] || null;
  }

  getAllProfiles(): UserProfile[] {
    return Object.values(this.profiles);
  }

  getAvatarData(address: string): string | null {
    const normalizedAddress = address.toLowerCase();
    const profile = this.profiles[normalizedAddress];
    return profile?.avatarUrl || null;
  }

  async createOrUpdateProfile(dto: UpdateProfileDto): Promise<UserProfile> {
    const normalizedAddress = dto.address.toLowerCase();

    // Validate
    if (dto.displayName) {
      this.validateDisplayName(dto.displayName);
    }
    if (dto.bio) {
      this.validateBio(dto.bio);
    }

    const existing = this.profiles[normalizedAddress];
    const now = Date.now();

    if (existing) {
      // Update existing
      const updated: UserProfile = {
        ...existing,
        displayName: dto.displayName ?? existing.displayName,
        bio: dto.bio ?? existing.bio,
        updatedAt: now,
      };
      this.profiles[normalizedAddress] = updated;
      await this.saveProfiles();
      this.logger.log(`Profile updated: ${normalizedAddress}`);
      return updated;
    } else {
      // Create new
      const newProfile: UserProfile = {
        address: normalizedAddress,
        displayName: dto.displayName || this.generateDefaultName(normalizedAddress),
        bio: dto.bio || '',
        avatarUrl: null,
        createdAt: now,
        updatedAt: now,
      };
      this.profiles[normalizedAddress] = newProfile;
      await this.saveProfiles();
      this.logger.log(`Profile created: ${normalizedAddress}`);
      return newProfile;
    }
  }

  async saveAvatar(address: string, fileBuffer: Buffer, mimeType: string): Promise<string> {
    const normalizedAddress = address.toLowerCase();

    // Validate mime type
    if (!PROFILE_CONSTRAINTS.ALLOWED_MIME_TYPES.includes(mimeType)) {
      throw new BadRequestException('Invalid file type. Use PNG, JPG or WEBP.');
    }

    // Validate size
    if (fileBuffer.length > PROFILE_CONSTRAINTS.AVATAR_MAX_SIZE) {
      throw new BadRequestException('File too large. Max 2MB.');
    }

    // Convert to base64 data URL for persistence
    const base64 = fileBuffer.toString('base64');
    const avatarUrl = `data:${mimeType};base64,${base64}`;

    if (this.profiles[normalizedAddress]) {
      this.profiles[normalizedAddress].avatarUrl = avatarUrl;
      this.profiles[normalizedAddress].updatedAt = Date.now();
    } else {
      // Create profile with avatar
      this.profiles[normalizedAddress] = {
        address: normalizedAddress,
        displayName: this.generateDefaultName(normalizedAddress),
        bio: '',
        avatarUrl,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }

    await this.saveProfiles();
    this.logger.log(`Avatar saved for ${normalizedAddress} (${fileBuffer.length} bytes)`);

    return avatarUrl;
  }

  // ============================================
  // VALIDATION HELPERS
  // ============================================

  private validateDisplayName(name: string): void {
    if (name.length < PROFILE_CONSTRAINTS.DISPLAY_NAME_MIN) {
      throw new BadRequestException(`Name must be at least ${PROFILE_CONSTRAINTS.DISPLAY_NAME_MIN} characters`);
    }
    if (name.length > PROFILE_CONSTRAINTS.DISPLAY_NAME_MAX) {
      throw new BadRequestException(`Name must be at most ${PROFILE_CONSTRAINTS.DISPLAY_NAME_MAX} characters`);
    }
    // Allow alphanumeric, underscore, space
    if (!/^[a-zA-Z0-9_ ]+$/.test(name)) {
      throw new BadRequestException('Name can only contain letters, numbers, underscores and spaces');
    }
  }

  private validateBio(bio: string): void {
    if (bio.length > PROFILE_CONSTRAINTS.BIO_MAX) {
      throw new BadRequestException(`Bio must be at most ${PROFILE_CONSTRAINTS.BIO_MAX} characters`);
    }
  }

  private generateDefaultName(address: string): string {
    return `Pilot_${address.slice(2, 8)}`;
  }

  // ============================================
  // DIAGNOSTICS
  // ============================================

  getDiagnostics(): { redisConnected: boolean; profileCount: number; redisUrl: boolean } {
    return {
      redisConnected: this.redis !== null,
      profileCount: Object.keys(this.profiles).length,
      redisUrl: !!process.env.REDIS_URL,
    };
  }
}
