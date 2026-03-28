import { NextRequest } from "next/server";
import { getClientIp } from "./api-auth";

// ---------------------------------------------------------------------------
// Redis helpers - import the raw Redis singleton from our kv module
// We need raw INCR + EXPIRE which the kv wrapper doesn't expose,
// so we replicate the lazy singleton access here.
// ---------------------------------------------------------------------------

import { Redis } from "@upstash/redis";

let _redis: Redis | null | undefined;

function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    _redis = null;
    return null;
  }
  _redis = new Redis({ url, token });
  return _redis;
}

// ---------------------------------------------------------------------------
// In-memory fallback store (used when Redis is unavailable)
// ---------------------------------------------------------------------------

const memWindows = new Map<string, { count: number; expiresAt: number }>();

// Periodic cleanup so the map doesn't grow unbounded
let lastCleanup = Date.now();
function cleanupMem() {
  const now = Date.now();
  if (now - lastCleanup < 60_000) return; // once a minute max
  lastCleanup = now;
  memWindows.forEach((entry, key) => {
    if (entry.expiresAt <= now) memWindows.delete(key);
  });
}

// ---------------------------------------------------------------------------
// Rate-limit result
// ---------------------------------------------------------------------------

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  reset: number; // epoch seconds when the window resets
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface RateLimiterOptions {
  /** Maximum requests allowed within the window. */
  max: number;
  /** Window duration in milliseconds. */
  windowMs: number;
  /** A unique route identifier used in the Redis key (e.g. "chat:messages:get"). */
  route: string;
}

export interface RateLimiter {
  check(req: NextRequest): Promise<RateLimitResult>;
}

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const { max, windowMs, route } = opts;
  const windowSec = Math.ceil(windowMs / 1000);

  return {
    async check(req: NextRequest): Promise<RateLimitResult> {
      const ip = getClientIp(req);
      const windowId = Math.floor(Date.now() / windowMs);
      const key = `ratelimit:${ip}:${route}:${windowId}`;
      const resetEpochSec = Math.ceil(((windowId + 1) * windowMs) / 1000);

      const r = getRedis();

      if (r) {
        try {
          // INCR is atomic — creates the key with value 1 if it doesn't exist
          const count = await r.incr(key);

          // Set expiry only on first increment so the key auto-cleans up
          if (count === 1) {
            await r.expire(key, windowSec + 1); // +1s buffer
          }

          const remaining = Math.max(0, max - count);
          return { success: count <= max, remaining, reset: resetEpochSec };
        } catch (err) {
          // Redis error — fall through to in-memory
          console.warn("rate-limit: Redis error, falling back to memory", err);
        }
      }

      // In-memory fallback
      cleanupMem();
      const now = Date.now();
      let entry = memWindows.get(key);
      if (!entry || entry.expiresAt <= now) {
        entry = { count: 0, expiresAt: now + windowMs };
        memWindows.set(key, entry);
      }
      entry.count++;
      const remaining = Math.max(0, max - entry.count);
      return { success: entry.count <= max, remaining, reset: resetEpochSec };
    },
  };
}
