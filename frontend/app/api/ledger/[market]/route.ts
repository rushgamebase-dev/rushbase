import { NextRequest, NextResponse } from "next/server";
import { kv, KEYS } from "@/lib/redis";
import type { MarketRecord } from "@/lib/ledger";

export const dynamic = "force-dynamic";

// GET /api/ledger/[market]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ market: string }> },
) {
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

    return NextResponse.json(record);
  } catch (error) {
    console.error("GET /api/ledger/[market] error:", error);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
