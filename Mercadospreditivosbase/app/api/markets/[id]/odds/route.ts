import { NextRequest, NextResponse } from "next/server";
import { kv, KEYS } from "@/lib/redis";
import { rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/api-auth";
import type { OddsSnapshot, MarketRecord } from "@/lib/api-types";
import { MOCK_MARKETS } from "@/lib/mock-data";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ip = getClientIp(req);
  // High-frequency path: 60 req/min
  const rl = await rateLimit(ip, "market-odds", 60, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: rateLimitHeaders(rl) }
    );
  }

  const id = params.id?.toLowerCase();
  if (!id) {
    return NextResponse.json({ error: "Market ID required" }, { status: 400 });
  }

  try {
    // Try to read the odds hash directly (hot path)
    const oddsHash = await kv.hgetall<Record<string, string>>(KEYS.marketOdds(id));

    if (oddsHash && Object.keys(oddsHash).length > 0) {
      // The odds hash stores outcomeId -> pool (wei string)
      // We also need outcome metadata from the market record
      const market = await kv.hgetall<MarketRecord>(KEYS.market(id));
      if (!market) {
        return NextResponse.json({ error: "Market not found" }, { status: 404 });
      }

      const totalPool = Object.values(oddsHash).reduce(
        (sum, v) => sum + BigInt(v),
        BigInt(0)
      );

      const outcomes = market.outcomes.map((o) => {
        const pool = BigInt(oddsHash[o.id] ?? "0");
        const probability =
          totalPool > BigInt(0)
            ? Math.round((Number(pool) / Number(totalPool)) * 100)
            : 0;
        const odds =
          pool > BigInt(0) ? Number(totalPool) / Number(pool) : 0;

        return {
          id: o.id,
          label: o.label,
          pool: pool.toString(),
          probability,
          odds: Math.round(odds * 100) / 100,
        };
      });

      const snapshot: OddsSnapshot = {
        marketAddress: id,
        outcomes,
        totalPool: totalPool.toString(),
        timestamp: Date.now(),
        updatedAt: Date.now(),
      };

      return NextResponse.json(
        { odds: snapshot },
        { headers: rateLimitHeaders(rl) }
      );
    }

    // Fallback: read from market record or mock data
    const market = await kv.hgetall<MarketRecord>(KEYS.market(id));

    if (market) {
      const snapshot: OddsSnapshot = {
        marketAddress: id,
        outcomes: market.outcomes.map((o) => ({
          id: o.id,
          label: o.label,
          pool: o.pool,
          probability: o.probability,
          odds: o.odds,
        })),
        totalPool: market.totalPool,
        timestamp: Date.now(),
        updatedAt: Date.now(),
      };
      return NextResponse.json(
        { odds: snapshot },
        { headers: rateLimitHeaders(rl) }
      );
    }

    // Last resort: mock data
    const mock = MOCK_MARKETS.find(
      (m) => m.address.toLowerCase() === id || m.id === id
    );
    if (!mock) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }

    const snapshot: OddsSnapshot = {
      marketAddress: mock.address,
      outcomes: mock.outcomes.map((o) => ({
        id: o.id,
        label: o.label,
        pool: o.pool.toString(),
        probability: o.probability,
        odds: o.odds,
      })),
      totalPool: mock.totalPool.toString(),
      timestamp: Date.now(),
      updatedAt: Date.now(),
    };

    return NextResponse.json(
      { odds: snapshot },
      { headers: rateLimitHeaders(rl) }
    );
  } catch (err) {
    console.error("[GET /api/markets/[id]/odds]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
