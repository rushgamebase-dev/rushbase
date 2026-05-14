import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisLockService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisLockService.name);
  private redis: Redis | null = null;

  async onModuleInit() {
    const redisUrl = process.env.REDIS_URL;

    if (!redisUrl) {
      this.logger.warn('REDIS_URL not set — distributed locks disabled, falling back to in-process locks');
      return;
    }

    try {
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => Math.min(times * 200, 3000),
      });
      this.redis.on('error', (err) => {
        this.logger.error('Redis lock connection error:', err.message);
      });
      await this.redis.ping();
      this.logger.log('Redis lock service connected');
    } catch (error) {
      this.logger.error('Failed to connect Redis for locks:', error);
      this.redis = null;
    }
  }

  async onModuleDestroy() {
    if (this.redis) {
      await this.redis.quit();
    }
  }

  /**
   * Attempt to acquire a distributed lock using SETNX + TTL.
   * Returns true if lock acquired, false if already held.
   * TTL ensures automatic release if holder crashes.
   */
  async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    if (!this.redis) {
      // Fallback: no Redis, always "acquire" (in-memory dedup still runs in caller)
      return true;
    }

    try {
      const result = await this.redis.set(key, Date.now().toString(), 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch (error) {
      this.logger.error(`Failed to acquire lock ${key}:`, error);
      // On Redis failure, allow operation to proceed (graceful degradation)
      return true;
    }
  }

  /**
   * Release a distributed lock.
   */
  async releaseLock(key: string): Promise<void> {
    if (!this.redis) return;

    try {
      await this.redis.del(key);
    } catch (error) {
      this.logger.error(`Failed to release lock ${key}:`, error);
    }
  }

  /**
   * Check if a lock is currently held.
   */
  async isLocked(key: string): Promise<boolean> {
    if (!this.redis) return false;

    try {
      const exists = await this.redis.exists(key);
      return exists === 1;
    } catch (error) {
      this.logger.error(`Failed to check lock ${key}:`, error);
      return false;
    }
  }

  /**
   * Clear all arena processing locks (used after contract upgrades)
   */
  async clearArenaLocks(): Promise<number> {
    if (!this.redis) return 0;
    try {
      const keys = await this.redis.keys('lock:arena:process:*');
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
      this.logger.warn(`Cleared ${keys.length} arena locks from Redis`);
      return keys.length;
    } catch (error) {
      this.logger.error('Failed to clear arena locks:', error);
      return 0;
    }
  }

  get isConnected(): boolean {
    return this.redis !== null;
  }
}
