import { NextRequest, NextResponse } from "next/server";
import { kv, KEYS } from "@/lib/redis";
import { rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/api-auth";
import type { PlatformStats } from "@/lib/api-types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await rateLimit(ip, "stats", 20, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: rateLimitHeaders(rl) }
    );
  }

  try {
    const raw = await kv.hgetall<Record<string, string>>(KEYS.stats);

    const totalMarketsCount = await kv.zcard(KEYS.markets);

    const stats: PlatformStats = {
      totalVolume: parseFloat(raw?.totalVolume_eth ?? "0"),
      totalMarkets: totalMarketsCount || parseInt(raw?.totalMarkets ?? "0", 10),
      marketsResolved: parseInt(raw?.marketsResolved ?? "0", 10),
      marketsOpen: parseInt(raw?.marketsOpen ?? "0", 10),
      uniqueBettors: parseInt(raw?.uniqueBettors ?? "0", 10),
      feesDistributed: parseFloat(raw?.feesDistributed_eth ?? "0"),
      avgPoolSize:
        totalMarketsCount > 0
          ? parseFloat(raw?.totalVolume_eth ?? "0") / totalMarketsCount
          : 0,
      biggestMarket: parseFloat(raw?.biggestMarket_eth ?? "0"),
      volume24h: parseFloat(raw?.volume24h_eth ?? "0"),
      bets24h: parseInt(raw?.bets24h ?? "0", 10),
      // Legacy fields
      totalBets: parseInt(raw?.totalBets ?? "0", 10),
      uniqueTraders: parseInt(raw?.uniqueBettors ?? "0", 10),
      openMarkets: parseInt(raw?.marketsOpen ?? "0", 10),
      resolvedMarkets: parseInt(raw?.marketsResolved ?? "0", 10),
      updatedAt: Date.now(),
    };

    return NextResponse.json(
      { stats },
      { headers: rateLimitHeaders(rl) }
    );
  } catch (err) {
    console.error("[GET /api/stats]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
