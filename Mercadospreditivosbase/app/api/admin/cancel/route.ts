import { NextRequest, NextResponse } from "next/server";
import { kv, KEYS } from "@/lib/redis";
import { requireApiKey, validateAddress, sanitizeText } from "@/lib/api-auth";
import { logAudit } from "@/lib/audit";
import { broadcast } from "@/lib/ably-server";
import type { MarketRecord } from "@/lib/api-types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!requireApiKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { marketAddress?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const marketAddress = typeof body.marketAddress === "string"
    ? body.marketAddress.toLowerCase()
    : "";
  const reason = typeof body.reason === "string"
    ? sanitizeText(body.reason, 500)
    : undefined;

  if (!validateAddress(marketAddress)) {
    return NextResponse.json({ error: "Invalid marketAddress" }, { status: 400 });
  }

  try {
    const market = await kv.hgetall<MarketRecord>(KEYS.market(marketAddress));
    if (!market) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }
    if (market.status === "cancelled") {
      return NextResponse.json({ error: "Market already cancelled" }, { status: 409 });
    }
    if (market.status === "resolved") {
      return NextResponse.json({ error: "Cannot cancel a resolved market" }, { status: 409 });
    }

    const now = Date.now();
    const wasOpen = market.status === "open";

    const updatedMarket: MarketRecord = {
      ...market,
      status: "cancelled",
      cancelledAt: now,
      cancelReason: reason,
    };

    await kv.hset(KEYS.market(marketAddress), updatedMarket as unknown as Record<string, unknown>);

    // Update stats
    if (wasOpen) {
      await kv.hincrby(KEYS.stats, "marketsOpen", -1);
    }

    // Log audit
    await logAudit({
      event: "market_cancelled",
      marketAddress,
      data: {
        reason: reason ?? "No reason provided",
        previousStatus: market.status,
        totalPool: market.totalPool,
      },
      source: "api",
      timestamp: now,
    });

    // Broadcast
    void broadcast.marketCancelled({ marketAddress, reason });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/admin/cancel]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
