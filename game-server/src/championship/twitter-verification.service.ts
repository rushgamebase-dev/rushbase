// ============================================
// TWITTER VERIFICATION SERVICE
// Verifies user tweeted with unique code
// Uses twitterapi.io for tweet search
// ============================================

import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'crypto';
import Redis from 'ioredis';

const REDIS_PREFIX = 'rushroyale:twitter_verified:';
const VERIFICATION_TTL = 7 * 24 * 60 * 60; // 7 days
const HMAC_SECRET = process.env.TWITTER_VERIFICATION_SECRET || 'rush-royale-twitter-verification-2026';

export interface VerificationStatus {
  verified: boolean;
  tweetId?: string;
}

@Injectable()
export class TwitterVerificationService {
  private readonly logger = new Logger(TwitterVerificationService.name);
  private redis: Redis | null = null;
  private readonly apiKey: string | null;

  constructor() {
    this.apiKey = process.env.TWITTER_API_KEY || null;
    this.logger.log(`Twitter verification: API key ${this.apiKey ? 'SET' : 'NOT SET'}`);
    this.connectRedis();
  }

  private async connectRedis(): Promise<void> {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      this.logger.warn('REDIS_URL not set, Twitter verification will bypass');
      return;
    }
    try {
      this.redis = new Redis(redisUrl);
      this.redis.on('error', (err) => {
        this.logger.error(`Redis error: ${err.message}`);
      });
      this.redis.on('connect', () => {
        this.logger.log('Redis connected for Twitter verification');
      });
    } catch (err: any) {
      this.logger.error(`Redis connection failed: ${err.message}`);
    }
  }

  get isEnabled(): boolean {
    return !!this.apiKey;
  }

  /**
   * Generate deterministic verification code from wallet address
   */
  generateCode(wallet: string): string {
    const hmac = createHmac('sha256', HMAC_SECRET)
      .update(wallet.toLowerCase())
      .digest('hex');
    return `RR-${hmac.slice(0, 8).toUpperCase()}`;
  }

  /**
   * Build Twitter intent URL with pre-filled tweet
   */
  buildTweetUrl(code: string): string {
    const text = `Entering the Rush Royale Championship. Code: ${code}\n\n${process.env.FRONTEND_URL || 'https://www.rushgame.vip'}/arenas/championship`;
    return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
  }

  /**
   * Check if wallet is already verified
   */
  async isVerified(wallet: string): Promise<VerificationStatus> {
    // No API key → bypass verification
    if (!this.apiKey) {
      return { verified: true };
    }

    // No Redis → bypass verification
    if (!this.redis) {
      return { verified: true };
    }

    try {
      const tweetId = await this.redis.get(`${REDIS_PREFIX}${wallet.toLowerCase()}`);
      if (tweetId) {
        return { verified: true, tweetId };
      }
      return { verified: false };
    } catch (err: any) {
      this.logger.error(`Redis get error in isVerified: ${err.message}`);
      // Redis error → bypass
      return { verified: true };
    }
  }

  /**
   * Search for tweet with verification code
   */
  async verifyTweet(wallet: string): Promise<{ verified: boolean; tweetId?: string; error?: string }> {
    // No API key → auto-verify
    if (!this.apiKey) {
      return { verified: true };
    }

    const code = this.generateCode(wallet);

    // Check if already verified
    const existing = await this.isVerified(wallet);
    if (existing.verified) {
      return { verified: true, tweetId: existing.tweetId };
    }

    try {
      // Search twitterapi.io for tweets containing the code
      const searchParams = new URLSearchParams({
        query: `"${code}"`,
        queryType: 'Latest',
      });
      const response = await fetch(`https://api.twitterapi.io/twitter/tweet/advanced_search?${searchParams}`, {
        method: 'GET',
        headers: {
          'X-API-Key': this.apiKey,
        },
      });

      if (!response.ok) {
        this.logger.error(`Twitter API error: ${response.status} ${response.statusText}`);
        return { verified: false, error: 'Twitter API error. Try again later.' };
      }

      const data = await response.json();
      const tweets = data.tweets || [];

      if (!tweets.length) {
        return { verified: false, error: 'Tweet nao encontrado. Poste o tweet e aguarde alguns segundos.' };
      }

      // First tweet containing the code is enough
      const tweet = tweets[0];
      const tweetId = tweet.id || tweet.id_str || 'verified';

      // Store in Redis
      if (this.redis) {
        try {
          await this.redis.set(
            `${REDIS_PREFIX}${wallet.toLowerCase()}`,
            tweetId,
            'EX',
            VERIFICATION_TTL,
          );
        } catch {}
      }

      this.logger.log(`Twitter verified: ${wallet} → tweet ${tweetId}`);
      return { verified: true, tweetId };
    } catch (err: any) {
      this.logger.error(`Twitter verification error: ${err.message}`);
      return { verified: false, error: 'Verification failed. Try again.' };
    }
  }
}
