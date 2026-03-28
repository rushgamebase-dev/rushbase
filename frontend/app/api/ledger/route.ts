import { NextRequest, NextResponse } from "next/server";
import { kv, KEYS } from "@/lib/redis";
import { createRateLimiter } from "@/lib/rate-limit";
import { requireApiKey } from "@/lib/api-auth";
import { logAudit } from "@/lib/audit";
import type { MarketRecord } from "@/lib/ledger";

export const dynamic = "force-dynamic";

const getLimiter = createRateLimiter({ max: 10, windowMs: 60_000, route: "ledger:get" });
const postLimiter = createRateLimiter({ max: 5, windowMs: 60_000, route: "ledger:post" });

// GET /api/ledger?limit=<n>&offset=<n>
// Returns all market records (most recent first).
export async function GET(req: NextRequest) {
  const rl = await getLimiter.check(req);
  if (!rl.success) {
    return NextResponse.json({ error: "rate limited" }, {
      status: 429,
      headers: {
        "X-RateLimit-Remaining": String(rl.remaining),
        "X-RateLimit-Reset": String(rl.reset),
      },
    });
  }

  try {
    const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") || "50"), 200);
    const offset = Number(req.nextUrl.searchParams.get("offset") || "0");

    // Get market addresses from sorted set (newest first)
    const addresses = await kv.zrevrange(KEYS.ledgerMarkets, offset, offset + limit - 1);

    // Fetch each market record
    const markets: MarketRecord[] = [];
    for (const addr of addresses) {
      const record = await kv.hgetall<MarketRecord>(KEYS.ledgerMarket(addr));
      if (record) {
        // Parse bets if stored as string
        if (typeof record.bets === "string") {
          try { record.bets = JSON.parse(record.bets as unknown as string); } catch { record.bets = []; }
        }
        markets.push(record);
      }
    }

    return NextResponse.json({ markets, total: await kv.zcard(KEYS.ledgerMarkets) }, {
      headers: {
        "X-RateLimit-Remaining": String(rl.remaining),
        "X-RateLimit-Reset": String(rl.reset),
      },
    });
  } catch (error) {
    console.error("GET /api/ledger error:", error);
    return NextResponse.json({ markets: [], total: 0 });
  }
}

// POST /api/ledger — Called by oracle round_manager after resolving a market.
// Body: MarketRecord JSON
export async function POST(req: NextRequest) {
  // API key required
  if (!requireApiKey(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rl = await postLimiter.check(req);
  if (!rl.success) {
    return NextResponse.json({ error: "rate limited" }, {
      status: 429,
      headers: {
        "X-RateLimit-Remaining": String(rl.remaining),
        "X-RateLimit-Reset": String(rl.reset),
      },
    });
  }

  try {
    const record = (await req.json()) as MarketRecord;

    if (!record.address || !record.createdAt) {
      return NextResponse.json({ error: "address and createdAt required" }, { status: 400 });
    }

    const addr = record.address.toLowerCase();

    // Idempotency: check if this market was already recorded with same state
    const existing = await kv.hgetall<Record<string, string>>(KEYS.ledgerMarket(addr));
    const alreadyResolved = existing?.state === "resolved";

    // If already resolved, don't re-increment stats (idempotent)
    if (alreadyResolved && record.state === "resolved") {
      return NextResponse.json({ ok: true, deduplicated: true }, {
        headers: {
          "X-RateLimit-Remaining": String(rl.remaining),
          "X-RateLimit-Reset": String(rl.reset),
        },
      });
    }

    // Store market record as hash
    await kv.hset(KEYS.ledgerMarket(addr), {
      ...record,
      address: addr,
      bets: JSON.stringify(record.bets || []),
      evidence: record.evidence ? JSON.stringify(record.evidence) : "",
    });

    // Add to sorted set (score = createdAt for ordering)
    await kv.zadd(KEYS.ledgerMarkets, record.createdAt, addr);

    // Update aggregate stats
    const pool = parseFloat(record.totalPool) || 0;
    const fee = parseFloat(record.feeCollected) || 0;

    if (record.state === "resolved") {
      await kv.hincrby(KEYS.stats, "marketsResolved", 1);
      await kv.hincrbyfloat(KEYS.stats, "totalVolume", pool);
      await kv.hincrbyfloat(KEYS.stats, "feesCollected", fee);
      await kv.hincrby(KEYS.stats, "totalBettors", record.totalBettors || 0);

      // Track biggest round
      const stats = await kv.hgetall<Record<string, string>>(KEYS.stats);
      const currentBiggest = parseFloat(stats?.biggestRound || "0");
      if (pool > currentBiggest) {
        await kv.hset(KEYS.stats, { biggestRound: pool.toString() });
      }

      // Add to round history
      const historyEntry = {
        roundNumber: record.roundNumber || 0,
        marketAddress: addr,
        result: (record.actualCount ?? 0) > record.threshold ? "over" : "under",
        actualCount: record.actualCount ?? 0,
        threshold: record.threshold,
        totalPool: record.totalPool,
        resolvedAt: record.resolvedAt || Date.now(),
      };
      await kv.lpush(KEYS.roundsHistory, JSON.stringify(historyEntry));
      await kv.ltrim(KEYS.roundsHistory, 0, 99); // Keep last 100 rounds
    }

    // Index bets by user for profile
    if (record.bets && record.bets.length > 0) {
      for (const bet of record.bets) {
        if (bet.user) {
          const profileBet = {
            ...bet,
            marketAddress: addr,
            marketDescription: record.description,
            threshold: record.threshold,
            actualCount: record.actualCount,
            marketState: record.state,
            resolvedAt: record.resolvedAt,
          };
          await kv.lpush(KEYS.profileBets(bet.user), JSON.stringify(profileBet));
          await kv.ltrim(KEYS.profileBets(bet.user), 0, 199); // Keep last 200 bets per user
        }
      }
    }

    // ── Audit logging (best-effort, never blocks the response) ──────────
    try {
      const auditEvent = record.state === "resolved" ? "market_resolved" as const
        : record.state === "cancelled" ? "market_cancelled" as const
        : "market_created" as const;

      await logAudit({
        timestamp: Date.now(),
        event: auditEvent,
        marketAddress: addr,
        data: {
          roundNumber: record.roundNumber,
          threshold: record.threshold,
          actualCount: record.actualCount,
          winningRange: record.winningRange,
          totalPool: record.totalPool,
          totalBettors: record.totalBettors,
          txHashCreate: record.txHashCreate,
          txHashResolve: record.txHashResolve,
        },
        source: "oracle",
      });

      // If evidence was included, log a separate evidence_stored event
      if (record.evidence) {
        const ev = record.evidence;
        await logAudit({
          timestamp: Date.now(),
          event: "evidence_stored",
          marketAddress: addr,
          data: {
            frameCount: ev.frames?.length ?? 0,
            finalFrame: ev.finalFrame ?? null,
            hashCount: ev.frameHashes?.length ?? 0,
          },
          source: "oracle",
        });
      }
    } catch (auditErr) {
      console.error("Audit logging failed (non-fatal):", auditErr);
    }

    return NextResponse.json({ ok: true }, {
      headers: {
        "X-RateLimit-Remaining": String(rl.remaining),
        "X-RateLimit-Reset": String(rl.reset),
      },
    });
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
}
