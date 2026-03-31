import { NextRequest, NextResponse } from "next/server";
import { kv, KEYS } from "@/lib/redis";
import { rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/api-auth";
import type { MarketRecord, BetRecord } from "@/lib/api-types";
import { MOCK_MARKETS } from "@/lib/mock-data";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ip = getClientIp(req);
  const rl = await rateLimit(ip, "market-detail", 20, 60_000);
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
    let market = await kv.hgetall<MarketRecord>(KEYS.market(id));

    if (!market) {
      // Fallback: look in mock data by address or id
      const mock = MOCK_MARKETS.find(
        (m) => m.address.toLowerCase() === id || m.id === id
      );
      if (!mock) {
        return NextResponse.json({ error: "Market not found" }, { status: 404 });
      }
      market = {
        address: mock.address,
        title: mock.title,
        description: mock.description,
        category: mock.category,
        icon: mock.icon ?? "📊",
        createdAt: mock.createdAt instanceof Date ? mock.createdAt.getTime() : Number(mock.createdAt),
        closeDate: mock.closeDate instanceof Date ? mock.closeDate.getTime() : Number(mock.closeDate),
        resolutionDate: mock.resolutionDate instanceof Date ? mock.resolutionDate.getTime() : Number(mock.resolutionDate),
        resolutionSource: mock.resolutionSource,
        status: mock.status,
        resolvedAt: null,
        outcomes: mock.outcomes.map((o) => ({
          id: o.id,
          label: o.label,
          pool: o.pool.toString(),
          probability: o.probability,
          odds: o.odds,
        })),
        winningOutcomeId: null,
        totalPool: mock.totalPool.toString(),
        totalBettors: Math.floor(Number(mock.totalPool) / 1e18 * 15),
        feeCollected: "0",
        txHashCreate: "0x0000000000000000000000000000000000000000000000000000000000000000",
        txHashResolve: null,
        isHot: mock.isHot ?? false,
      };
    }

    const rawBets = await kv.lrange<BetRecord>(KEYS.marketBets(id), 0, 49);

    return NextResponse.json(
      { market, bets: rawBets },
      { headers: rateLimitHeaders(rl) }
    );
  } catch (err) {
    console.error("[GET /api/markets/[id]]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
