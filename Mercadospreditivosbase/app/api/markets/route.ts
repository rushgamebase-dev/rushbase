import { NextRequest, NextResponse } from "next/server";
import { kv, KEYS } from "@/lib/redis";
import { rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/api-auth";
import type { MarketRecord } from "@/lib/api-types";
import { MOCK_MARKETS } from "@/lib/mock-data";
import type { MarketStatus } from "@/types/market";

export const dynamic = "force-dynamic";

function mockToRecord(m: (typeof MOCK_MARKETS)[number]): MarketRecord {
  return {
    address: m.address,
    title: m.title,
    description: m.description,
    category: m.category,
    icon: m.icon ?? "📊",
    createdAt: m.createdAt instanceof Date ? m.createdAt.getTime() : Number(m.createdAt),
    closeDate: m.closeDate instanceof Date ? m.closeDate.getTime() : Number(m.closeDate),
    resolutionDate: m.resolutionDate instanceof Date ? m.resolutionDate.getTime() : Number(m.resolutionDate),
    resolutionSource: m.resolutionSource,
    status: m.status,
    resolvedAt: null,
    cancelledAt: undefined,
    cancelReason: undefined,
    outcomes: m.outcomes.map((o) => ({
      id: o.id,
      label: o.label,
      pool: o.pool.toString(),
      probability: o.probability,
      odds: o.odds,
    })),
    winningOutcomeId: null,
    totalPool: m.totalPool.toString(),
    totalBettors: Math.floor(Number(m.totalPool) / 1e18 * 15),
    feeCollected: "0",
    txHashCreate: "0x0000000000000000000000000000000000000000000000000000000000000000",
    txHashResolve: null,
    isHot: m.isHot ?? false,
  };
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await rateLimit(ip, "markets", 20, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: rateLimitHeaders(rl) }
    );
  }

  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") ?? "all";
    const category = searchParams.get("category");
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? "50")));
    const offset = Math.max(0, Number(searchParams.get("offset") ?? "0"));

    // Fetch all market addresses from the sorted set
    const addresses = await kv.zrevrange(KEYS.markets, 0, -1);

    let markets: MarketRecord[] = [];

    if (addresses.length === 0) {
      // Fallback: return mock markets
      markets = MOCK_MARKETS.map(mockToRecord);
    } else {
      const records = await Promise.all(
        addresses.map((addr) => kv.hgetall<MarketRecord>(KEYS.market(addr)))
      );
      markets = records.filter((r): r is MarketRecord => r !== null);
    }

    // Filter by status
    const validStatuses: MarketStatus[] = ["open", "locked", "resolved", "cancelled"];
    if (status !== "all" && validStatuses.includes(status as MarketStatus)) {
      markets = markets.filter((m) => m.status === status);
    }

    // Filter by category
    if (category) {
      markets = markets.filter((m) => m.category === category);
    }

    const total = markets.length;
    const page = markets.slice(offset, offset + limit);

    return NextResponse.json(
      { markets: page, total },
      { headers: rateLimitHeaders(rl) }
    );
  } catch (err) {
    console.error("[GET /api/markets]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
