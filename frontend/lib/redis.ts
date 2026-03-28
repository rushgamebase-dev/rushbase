import { Redis } from "@upstash/redis";

// Singleton Redis client for all API routes.
// Requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN env vars.
// In Vercel, these are auto-set when you add an Upstash Redis integration.

// Lazy singleton — only connects when first accessed at runtime, not during build.
let _redis: Redis | null | undefined;

function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis;

  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    _redis = null;
    return null;
  }

  _redis = new Redis({ url, token });
  return _redis;
}

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
    const r = getRedis();
    if (r) return r.get<T>(key);
    return (memStore[key] as T) ?? null;
  },
  async set(key: string, value: unknown, opts?: { ex?: number }) {
    const r = getRedis();
    if (r) return r.set(key, value, opts?.ex ? { ex: opts.ex } : undefined);
    memStore[key] = value;
  },
  async lpush(key: string, ...values: unknown[]) {
    const r = getRedis();
    if (r) return r.lpush(key, ...values);
    if (!memStore[key]) memStore[key] = [];
    (memStore[key] as unknown[]).unshift(...values);
  },
  async lrange<T>(key: string, start: number, stop: number): Promise<T[]> {
    const r = getRedis();
    if (r) return r.lrange<T>(key, start, stop);
    const list = (memStore[key] as T[]) ?? [];
    return list.slice(start, stop === -1 ? undefined : stop + 1);
  },
  async ltrim(key: string, start: number, stop: number) {
    const r = getRedis();
    if (r) return r.ltrim(key, start, stop);
    if (memStore[key]) {
      (memStore[key] as unknown[]).splice(stop + 1);
    }
  },
  async hset(key: string, data: Record<string, unknown>) {
    const r = getRedis();
    if (r) return r.hset(key, data);
    memStore[key] = { ...((memStore[key] as Record<string, unknown>) ?? {}), ...data };
  },
  async hgetall<T = Record<string, unknown>>(key: string): Promise<T | null> {
    const r = getRedis();
    if (r) return r.hgetall(key) as Promise<T | null>;
    return (memStore[key] as T) ?? null;
  },
  async hincrby(key: string, field: string, increment: number) {
    const r = getRedis();
    if (r) return r.hincrby(key, field, increment);
    if (!memStore[key]) memStore[key] = {};
    const h = memStore[key] as Record<string, number>;
    h[field] = (h[field] ?? 0) + increment;
    return h[field];
  },
  async hincrbyfloat(key: string, field: string, increment: number) {
    const r = getRedis();
    if (r) return r.hincrbyfloat(key, field, increment);
    if (!memStore[key]) memStore[key] = {};
    const h = memStore[key] as Record<string, number>;
    h[field] = (h[field] ?? 0) + increment;
    return h[field];
  },
  async zadd(key: string, score: number, member: string) {
    const r = getRedis();
    if (r) return r.zadd(key, { score, member });
    if (!memStore[key]) memStore[key] = [];
    const zset = memStore[key] as { score: number; member: string }[];
    const idx = zset.findIndex((e) => e.member === member);
    if (idx >= 0) zset[idx].score = score;
    else zset.push({ score, member });
  },
  async zrangebyscore(key: string, min: number, max: number): Promise<string[]> {
    const r = getRedis();
    if (r) return r.zrange(key, min, max, { byScore: true });
    const zset = (memStore[key] as { score: number; member: string }[]) ?? [];
    return zset.filter((e) => e.score >= min && e.score <= max).map((e) => e.member);
  },
  async zcard(key: string): Promise<number> {
    const r = getRedis();
    if (r) return r.zcard(key);
    return ((memStore[key] as unknown[]) ?? []).length;
  },
  async zremrangebyscore(key: string, min: number, max: number) {
    const r = getRedis();
    if (r) return r.zremrangebyscore(key, min, max);
    if (!memStore[key]) return;
    const zset = memStore[key] as { score: number; member: string }[];
    memStore[key] = zset.filter((e) => !(e.score >= min && e.score <= max));
  },
  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    const r = getRedis();
    if (r) return r.zrange(key, start, stop, { rev: true });
    const zset = (memStore[key] as { score: number; member: string }[]) ?? [];
    const sorted = [...zset].sort((a, b) => b.score - a.score);
    return sorted.slice(start, stop + 1).map((e) => e.member);
  },
};
