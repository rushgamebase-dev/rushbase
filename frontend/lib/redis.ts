import { Redis } from "@upstash/redis";

// Singleton Redis client for all API routes.
// Requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN env vars.
// In Vercel, these are auto-set when you add an Upstash Redis integration.

function createRedis() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    // Return a mock redis that stores in-memory (dev fallback)
    return null;
  }

  return new Redis({ url, token });
}

export const redis = createRedis();

// ─── Key prefixes ────────────────────────────────────────────────────────────

export const KEYS = {
  // Chat
  chatMessages: "chat:messages",        // LIST of JSON messages
  chatOnline: "chat:online",            // ZSET: address → last_seen timestamp

  // Ledger
  ledgerMarkets: "ledger:markets",      // ZSET: market_address → createdAt (score)
  ledgerMarket: (addr: string) => `ledger:market:${addr.toLowerCase()}`,  // HASH

  // Stats (aggregated counters)
  stats: "stats",                        // HASH: totalVolume, marketsResolved, etc.

  // Profile
  profileBets: (addr: string) => `profile:bets:${addr.toLowerCase()}`,    // LIST of bets

  // Rounds history
  roundsHistory: "rounds:history",       // LIST of round results (most recent first)
} as const;

// ─── In-memory fallback for local dev ────────────────────────────────────────

const memStore: Record<string, unknown> = {};

export const kv = {
  async get<T>(key: string): Promise<T | null> {
    if (redis) return redis.get<T>(key);
    return (memStore[key] as T) ?? null;
  },
  async set(key: string, value: unknown, opts?: { ex?: number }) {
    if (redis) return redis.set(key, value, opts?.ex ? { ex: opts.ex } : undefined);
    memStore[key] = value;
  },
  async lpush(key: string, ...values: unknown[]) {
    if (redis) return redis.lpush(key, ...values);
    if (!memStore[key]) memStore[key] = [];
    (memStore[key] as unknown[]).unshift(...values);
  },
  async lrange<T>(key: string, start: number, stop: number): Promise<T[]> {
    if (redis) return redis.lrange<T>(key, start, stop);
    const list = (memStore[key] as T[]) ?? [];
    return list.slice(start, stop === -1 ? undefined : stop + 1);
  },
  async ltrim(key: string, start: number, stop: number) {
    if (redis) return redis.ltrim(key, start, stop);
    if (memStore[key]) {
      (memStore[key] as unknown[]).splice(stop + 1);
    }
  },
  async hset(key: string, data: Record<string, unknown>) {
    if (redis) return redis.hset(key, data);
    memStore[key] = { ...((memStore[key] as Record<string, unknown>) ?? {}), ...data };
  },
  async hgetall<T = Record<string, unknown>>(key: string): Promise<T | null> {
    if (redis) return redis.hgetall(key) as Promise<T | null>;
    return (memStore[key] as T) ?? null;
  },
  async hincrby(key: string, field: string, increment: number) {
    if (redis) return redis.hincrby(key, field, increment);
    if (!memStore[key]) memStore[key] = {};
    const h = memStore[key] as Record<string, number>;
    h[field] = (h[field] ?? 0) + increment;
    return h[field];
  },
  async hincrbyfloat(key: string, field: string, increment: number) {
    if (redis) return redis.hincrbyfloat(key, field, increment);
    if (!memStore[key]) memStore[key] = {};
    const h = memStore[key] as Record<string, number>;
    h[field] = (h[field] ?? 0) + increment;
    return h[field];
  },
  async zadd(key: string, score: number, member: string) {
    if (redis) return redis.zadd(key, { score, member });
    if (!memStore[key]) memStore[key] = [];
    const zset = memStore[key] as { score: number; member: string }[];
    const idx = zset.findIndex((e) => e.member === member);
    if (idx >= 0) zset[idx].score = score;
    else zset.push({ score, member });
  },
  async zrangebyscore(key: string, min: number, max: number): Promise<string[]> {
    if (redis) return redis.zrange(key, min, max, { byScore: true });
    const zset = (memStore[key] as { score: number; member: string }[]) ?? [];
    return zset.filter((e) => e.score >= min && e.score <= max).map((e) => e.member);
  },
  async zcard(key: string): Promise<number> {
    if (redis) return redis.zcard(key);
    return ((memStore[key] as unknown[]) ?? []).length;
  },
  async zremrangebyscore(key: string, min: number, max: number) {
    if (redis) return redis.zremrangebyscore(key, min, max);
    if (!memStore[key]) return;
    const zset = memStore[key] as { score: number; member: string }[];
    memStore[key] = zset.filter((e) => !(e.score >= min && e.score <= max));
  },
  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    if (redis) return redis.zrange(key, start, stop, { rev: true });
    const zset = (memStore[key] as { score: number; member: string }[]) ?? [];
    const sorted = [...zset].sort((a, b) => b.score - a.score);
    return sorted.slice(start, stop + 1).map((e) => e.member);
  },
};
