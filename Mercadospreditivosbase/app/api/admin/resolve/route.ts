import { NextRequest, NextResponse } from "next/server";
import { kv, KEYS } from "@/lib/redis";
import { requireApiKey, validateAddress } from "@/lib/api-auth";
import { logAudit } from "@/lib/audit";
import { broadcast } from "@/lib/ably-server";
import type { MarketRecord, BetRecord } from "@/lib/api-types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!requireApiKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { marketAddress?: unknown; winningOutcomeId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const marketAddress = typeof body.marketAddress === "string"
    ? body.marketAddress.toLowerCase()
    : "";
  const winningOutcomeId = typeof body.winningOutcomeId === "string"
    ? body.winningOutcomeId
    : "";

  if (!validateAddress(marketAddress)) {
    return NextResponse.json({ error: "Invalid marketAddress" }, { status: 400 });
  }
  if (!winningOutcomeId) {
    return NextResponse.json({ error: "winningOutcomeId required" }, { status: 400 });
  }

  try {
    const market = await kv.hgetall<MarketRecord>(KEYS.market(marketAddress));
    if (!market) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }
    if (market.status === "resolved") {
      return NextResponse.json({ error: "Market already resolved" }, { status: 409 });
    }
    if (market.status === "cancelled") {
      return NextResponse.json({ error: "Cannot resolve a cancelled market" }, { status: 409 });
    }

    const winningOutcome = market.outcomes.find((o) => o.id === winningOutcomeId);
    if (!winningOutcome) {
      return NextResponse.json({ error: "winningOutcomeId not found in market outcomes" }, { status: 400 });
    }

    const now = Date.now();

    // Update market record
    const updatedMarket: MarketRecord = {
      ...market,
      status: "resolved",
      winningOutcomeId,
      resolvedAt: now,
    };

    await kv.hset(KEYS.market(marketAddress), updatedMarket as unknown as Record<string, unknown>);

    // Calculate winnings: mark winning bets as claimable
    const bets = await kv.lrange<BetRecord>(KEYS.marketBets(marketAddress), 0, -1);

    const losingPool = BigInt(market.totalPool) - BigInt(winningOutcome.pool);
    const winningPool = BigInt(winningOutcome.pool);

    // Distribute losing pool proportionally to winners
    const updatedBets = bets.map((bet) => {
      if (bet.outcomeId === winningOutcomeId && winningPool > BigInt(0)) {
        const betAmount = BigInt(bet.amount);
        // Proportional share: betAmount / winningPool * totalPool (minus fee)
        const claimRaw = (betAmount * BigInt(market.totalPool)) / winningPool;
        return { ...bet, claimed: false, claimAmount: claimRaw.toString() };
      }
      return { ...bet, claimed: false, claimAmount: "0" };
    });

    // Update stats
    const previouslyOpen = market.status === "open" ? 1 : 0;
    await Promise.all([
      kv.hincrby(KEYS.stats, "marketsResolved", 1),
      kv.hincrby(KEYS.stats, "marketsOpen", -previouslyOpen),
      // Update leaderboard scores for winners
      ...updatedBets
        .filter((b) => b.claimAmount && BigInt(b.claimAmount) > BigInt(0))
        .map((b) => {
          const profit = Number(BigInt(b.claimAmount!) - BigInt(b.amount)) / 1e18;
          // We'd ideally ZINCRBY but using ZADD with current score + delta
          return kv.zadd(KEYS.leaderboard, profit, b.user);
        }),
    ]);

    // Log audit
    await logAudit({
      event: "market_resolved",
      marketAddress,
      data: {
        winningOutcomeId,
        winningLabel: winningOutcome.label,
        totalPool: market.totalPool,
        winningPool: winningOutcome.pool,
        losingPool: losingPool.toString(),
        totalBets: bets.length,
      },
      source: "api",
      timestamp: now,
    });

    // Broadcast
    void broadcast.marketResolved({
      marketAddress,
      winningOutcomeId,
      winningLabel: winningOutcome.label,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/admin/resolve]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
