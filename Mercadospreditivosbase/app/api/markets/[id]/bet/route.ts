import { NextRequest, NextResponse } from "next/server";
import { kv, KEYS } from "@/lib/redis";
import { rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { getClientIp, validateAddress, sanitizeText } from "@/lib/api-auth";
import { logAudit } from "@/lib/audit";
import { broadcast } from "@/lib/ably-server";
import type { BetRecord, MarketRecord } from "@/lib/api-types";

export const dynamic = "force-dynamic";

function isValidTxHash(hash: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(hash);
}

function isValidAmount(amount: string): boolean {
  if (!/^\d+$/.test(amount)) return false;
  try {
    const n = BigInt(amount);
    return n > BigInt(0);
  } catch {
    return false;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ip = getClientIp(req);
  const rl = await rateLimit(ip, "bet", 10, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: rateLimitHeaders(rl) }
    );
  }

  const marketAddress = params.id?.toLowerCase();
  if (!marketAddress) {
    return NextResponse.json({ error: "Market address required" }, { status: 400 });
  }

  let body: {
    user?: unknown;
    outcomeId?: unknown;
    outcomeLabel?: unknown;
    amount?: unknown;
    odds?: unknown;
    txHash?: unknown;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate inputs
  const user = typeof body.user === "string" ? body.user : "";
  const outcomeId = typeof body.outcomeId === "string" ? body.outcomeId : "";
  const outcomeLabel = typeof body.outcomeLabel === "string" ? body.outcomeLabel : "";
  const amount = typeof body.amount === "string" ? body.amount : "";
  const odds = typeof body.odds === "number" ? body.odds : 0;
  const txHash = typeof body.txHash === "string" ? body.txHash : "";

  if (!validateAddress(user)) {
    return NextResponse.json({ error: "Invalid user address" }, { status: 400 });
  }
  if (!outcomeId || !outcomeLabel) {
    return NextResponse.json({ error: "outcomeId and outcomeLabel required" }, { status: 400 });
  }
  if (!isValidAmount(amount)) {
    return NextResponse.json({ error: "Invalid amount (must be positive integer wei string)" }, { status: 400 });
  }
  if (!isValidTxHash(txHash)) {
    return NextResponse.json({ error: "Invalid txHash" }, { status: 400 });
  }
  if (odds <= 0 || !isFinite(odds)) {
    return NextResponse.json({ error: "Invalid odds" }, { status: 400 });
  }

  try {
    // Verify market exists and is open (skip check if not in Redis — allow for mock mode)
    const market = await kv.hgetall<MarketRecord>(KEYS.market(marketAddress));
    if (market && market.status !== "open") {
      return NextResponse.json(
        { error: `Market is ${market.status}, bets not accepted` },
        { status: 409 }
      );
    }

    const bet: BetRecord = {
      id: `bet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      marketAddress,
      user: user.toLowerCase(),
      outcomeId: sanitizeText(outcomeId, 64),
      outcomeLabel: sanitizeText(outcomeLabel, 128),
      amount,
      odds,
      txHash,
      timestamp: Date.now(),
      claimed: false,
      claimAmount: null,
    };

    // 1. Push to market bets list (ltrim 200)
    await kv.lpush(KEYS.marketBets(marketAddress), bet as unknown as string);
    await kv.ltrim(KEYS.marketBets(marketAddress), 0, 199);

    // 2. Push to global recent bets (ltrim 100)
    await kv.lpush(KEYS.recentBets, bet as unknown as string);
    await kv.ltrim(KEYS.recentBets, 0, 99);

    // 3. Push to user profile (ltrim 200)
    await kv.lpush(KEYS.profileBets(user.toLowerCase()), bet as unknown as string);
    await kv.ltrim(KEYS.profileBets(user.toLowerCase()), 0, 199);

    // 4. Update odds in pm:odds:{addr}
    const currentPool = await kv.hgetall<Record<string, string>>(KEYS.marketOdds(marketAddress));
    const existingPool = BigInt(currentPool?.[outcomeId] ?? "0");
    const newPool = existingPool + BigInt(amount);
    await kv.hset(KEYS.marketOdds(marketAddress), { [outcomeId]: newPool.toString() });

    // Recalculate all outcome odds for broadcast
    const updatedPoolHash = await kv.hgetall<Record<string, string>>(KEYS.marketOdds(marketAddress));
    const marketForOdds = market ?? null;

    let oddsPayload: { id: string; pool: string; probability: number; odds: number }[] = [];
    let totalPoolStr = "0";

    if (updatedPoolHash) {
      const totalPool = Object.values(updatedPoolHash).reduce(
        (sum, v) => sum + BigInt(v),
        BigInt(0)
      );
      totalPoolStr = totalPool.toString();

      oddsPayload = Object.entries(updatedPoolHash).map(([oId, pool]) => {
        const p = BigInt(pool);
        const prob = totalPool > BigInt(0) ? Math.round((Number(p) / Number(totalPool)) * 100) : 0;
        const o = p > BigInt(0) ? Number(totalPool) / Number(p) : 0;
        const label = marketForOdds?.outcomes.find((x) => x.id === oId)?.label ?? oId;
        return { id: oId, label, pool, probability: prob, odds: Math.round(o * 100) / 100 };
      });
    }

    // 5. Update aggregate stats
    await Promise.all([
      kv.hincrby(KEYS.stats, "totalBets", 1),
      kv.hincrby(KEYS.stats, "bets24h", 1),
      kv.hincrbyfloat(KEYS.stats, "totalVolume_eth", Number(amount) / 1e18),
      kv.hincrbyfloat(KEYS.stats, "volume24h_eth", Number(amount) / 1e18),
    ]);

    // 6. Log audit
    await logAudit({
      event: "bet_placed",
      marketAddress,
      data: {
        betId: bet.id,
        user: bet.user,
        outcomeId: bet.outcomeId,
        outcomeLabel: bet.outcomeLabel,
        amount: bet.amount,
        odds: bet.odds,
        txHash: bet.txHash,
      },
      source: "api",
      timestamp: Date.now(),
    });

    // 7. Broadcast via Ably (non-blocking, fire and forget)
    void broadcast.betPlaced({
      marketAddress,
      user: bet.user,
      outcomeLabel: bet.outcomeLabel,
      amount: bet.amount,
      odds: bet.odds,
      txHash: bet.txHash,
    });

    if (oddsPayload.length > 0) {
      void broadcast.oddsUpdated({
        marketAddress,
        outcomes: oddsPayload,
        totalPool: totalPoolStr,
      });
    }

    return NextResponse.json(
      { ok: true, bet },
      { status: 201, headers: rateLimitHeaders(rl) }
    );
  } catch (err) {
    console.error("[POST /api/markets/[id]/bet]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
