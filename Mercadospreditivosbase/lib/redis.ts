import { Redis } from "@upstash/redis";

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

// In-memory fallback for local dev
const memStore: Record<string, unknown> = {};

export const kv = {
  async get<T>(key: string): Promise<T | null> {
    const r = getRedis();
    if (r) return r.get<T>(key);
    return (memStore[key] as T) ?? null;
  },
  async set(key: string, value: unknown, opts?: { ex?: number }): Promise<void> {
    const r = getRedis();
    if (r) { await r.set(key, value, opts?.ex ? { ex: opts.ex } : undefined); return; }
    memStore[key] = value;
  },
  async lpush(key: string, ...values: unknown[]): Promise<void> {
    const r = getRedis();
    if (r) { await r.lpush(key, ...values); return; }
    if (!Array.isArray(memStore[key])) memStore[key] = [];
    (memStore[key] as unknown[]).unshift(...values);
  },
  async lrange<T>(key: string, start: number, stop: number): Promise<T[]> {
    const r = getRedis();
    if (r) return r.lrange<T>(key, start, stop);
    const arr = (memStore[key] as T[]) ?? [];
    return arr.slice(start, stop === -1 ? undefined : stop + 1);
  },
  async ltrim(key: string, start: number, stop: number): Promise<void> {
    const r = getRedis();
    if (r) { await r.ltrim(key, start, stop); return; }
    if (Array.isArray(memStore[key])) {
      memStore[key] = (memStore[key] as unknown[]).slice(start, stop + 1);
    }
  },
  async hset(key: string, data: Record<string, unknown>): Promise<void> {
    const r = getRedis();
    if (r) { await r.hset(key, data); return; }
    memStore[key] = { ...((memStore[key] as Record<string, unknown>) ?? {}), ...data };
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async hgetall<T = Record<string, unknown>>(key: string): Promise<T | null> {
    const r = getRedis();
    if (r) return r.hgetall<Record<string, unknown>>(key) as Promise<T | null>;
    return (memStore[key] as T) ?? null;
  },
  async hincrby(key: string, field: string, increment: number): Promise<number> {
    const r = getRedis();
    if (r) return r.hincrby(key, field, increment);
    if (!memStore[key]) memStore[key] = {};
    const obj = memStore[key] as Record<string, number>;
    obj[field] = (obj[field] ?? 0) + increment;
    return obj[field];
  },
  async hincrbyfloat(key: string, field: string, increment: number): Promise<number> {
    const r = getRedis();
    if (r) return r.hincrbyfloat(key, field, increment);
    if (!memStore[key]) memStore[key] = {};
    const obj = memStore[key] as Record<string, number>;
    obj[field] = (obj[field] ?? 0) + increment;
    return obj[field];
  },
  async zadd(key: string, score: number, member: string): Promise<void> {
    const r = getRedis();
    if (r) { await r.zadd(key, { score, member }); return; }
    if (!memStore[key]) memStore[key] = [];
    const arr = memStore[key] as { score: number; member: string }[];
    const existing = arr.findIndex(e => e.member === member);
    if (existing >= 0) arr[existing].score = score;
    else arr.push({ score, member });
    arr.sort((a, b) => b.score - a.score);
  },
  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    const r = getRedis();
    if (r) return r.zrange(key, start, stop, { rev: true });
    const arr = (memStore[key] as { score: number; member: string }[]) ?? [];
    return arr.slice(start, stop === -1 ? undefined : stop + 1).map(e => e.member);
  },
  async zcard(key: string): Promise<number> {
    const r = getRedis();
    if (r) return r.zcard(key);
    return ((memStore[key] as unknown[]) ?? []).length;
  },
  async incr(key: string): Promise<number> {
    const r = getRedis();
    if (r) return r.incr(key);
    memStore[key] = ((memStore[key] as number) ?? 0) + 1;
    return memStore[key] as number;
  },
  async expire(key: string, seconds: number): Promise<void> {
    const r = getRedis();
    if (r) { await r.expire(key, seconds); return; }
    // In-memory: no-op (keys persist)
  },
  async del(key: string): Promise<void> {
    const r = getRedis();
    if (r) { await r.del(key); return; }
    delete memStore[key];
  },
  async zremrangebyscore(key: string, min: number | "-inf", max: number | "+inf"): Promise<void> {
    const r = getRedis();
    if (r) { await r.zremrangebyscore(key, min === "-inf" ? "-inf" : min, max === "+inf" ? "+inf" : max); return; }
    if (!memStore[key]) return;
    const arr = memStore[key] as { score: number; member: string }[];
    const minN = min === "-inf" ? -Infinity : min;
    const maxN = max === "+inf" ? Infinity : max;
    memStore[key] = arr.filter(e => e.score < minN || e.score > maxN);
  },
  async zrangebyscore(key: string, min: number | "-inf", max: number | "+inf"): Promise<string[]> {
    const r = getRedis();
    if (r) {
      // Upstash Redis uses zrange with byScore option instead of zrangebyscore
      return r.zrange(key, min === "-inf" ? "-inf" : min, max === "+inf" ? "+inf" : max, { byScore: true });
    }
    const arr = (memStore[key] as { score: number; member: string }[]) ?? [];
    const minN = min === "-inf" ? -Infinity : min;
    const maxN = max === "+inf" ? Infinity : max;
    return arr
      .filter(e => e.score >= minN && e.score <= maxN)
      .sort((a, b) => a.score - b.score)
      .map(e => e.member);
  },
};

// Key patterns
export const KEYS = {
  // Markets
  markets: "pm:markets",                              // ZSET (addr -> createdAt)
  market: (addr: string) => `pm:market:${addr}`,      // HASH per market
  marketOdds: (addr: string) => `pm:odds:${addr}`,    // HASH (outcomeId -> pool)
  marketBets: (addr: string) => `pm:bets:${addr}`,    // LIST of recent bets

  // Stats
  stats: "pm:stats",                                  // HASH (aggregate counters)

  // Profile
  profileBets: (addr: string) => `pm:profile:${addr}`, // LIST per user

  // Activity
  recentBets: "pm:recent-bets",                       // LIST (global recent bets)

  // Leaderboard
  leaderboard: "pm:leaderboard",                      // ZSET (addr -> profit)

  // Audit
  auditEvents: "pm:audit",                            // LIST (global)
  auditMarket: (addr: string) => `pm:audit:${addr}`,  // LIST (per market)

  // Chat
  chatMessages: "pm:chat:messages",                   // LIST
  chatOnline: "pm:chat:online",                       // ZSET (addr -> timestamp)

  // Health
  healthPing: "pm:health:ping",                       // STRING
};
