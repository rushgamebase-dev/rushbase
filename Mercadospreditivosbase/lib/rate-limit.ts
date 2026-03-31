import { kv } from "./redis";

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  reset: number;
}

const memLimiter = new Map<string, { count: number; expiresAt: number }>();

export async function rateLimit(
  ip: string,
  route: string,
  max: number,
  windowMs: number
): Promise<RateLimitResult> {
  const windowId = Math.floor(Date.now() / windowMs);
  const key = `ratelimit:${ip}:${route}:${windowId}`;
  const windowSec = Math.ceil(windowMs / 1000);
  const resetEpochSec = Math.ceil(((windowId + 1) * windowMs) / 1000);

  try {
    const count = await kv.incr(key);
    if (count === 1) await kv.expire(key, windowSec + 1);
    return { success: count <= max, remaining: Math.max(0, max - count), reset: resetEpochSec };
  } catch {
    // Fallback to in-memory
    const now = Date.now();
    const entry = memLimiter.get(key);
    if (!entry || entry.expiresAt < now) {
      memLimiter.set(key, { count: 1, expiresAt: now + windowMs });
      return { success: true, remaining: max - 1, reset: resetEpochSec };
    }
    entry.count++;
    return { success: entry.count <= max, remaining: Math.max(0, max - entry.count), reset: resetEpochSec };
  }
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(result.reset),
  };
}
