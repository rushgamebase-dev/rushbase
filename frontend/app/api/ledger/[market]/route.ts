import { NextRequest, NextResponse } from "next/server";
import { kv, KEYS } from "@/lib/redis";
import { createRateLimiter } from "@/lib/rate-limit";
import type { MarketRecord } from "@/lib/ledger";

export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ max: 10, windowMs: 60_000, route: "ledger:market:get" });

// GET /api/ledger/[market]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ market: string }> },
) {
  const rl = await limiter.check(req);
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
    const { market } = await params;

    if (!market || !/^0x[a-fA-F0-9]{40}$/.test(market)) {
      return NextResponse.json({ error: "invalid market address" }, { status: 400 });
    }

    const record = await kv.hgetall<MarketRecord>(KEYS.ledgerMarket(market));

    if (!record) {
      return NextResponse.json({ error: "market not found" }, { status: 404 });
    }

    // Parse bets if stored as string
    if (typeof record.bets === "string") {
      try { record.bets = JSON.parse(record.bets as unknown as string); } catch { record.bets = []; }
    }

    return NextResponse.json(record, {
      headers: {
        "X-RateLimit-Remaining": String(rl.remaining),
        "X-RateLimit-Reset": String(rl.reset),
      },
    });
  } catch (error) {
    console.error("GET /api/ledger/[market] error:", error);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
