import { NextRequest, NextResponse } from "next/server";
import { kv, KEYS } from "@/lib/redis";
import { requireApiKey, validateAddress, sanitizeText } from "@/lib/api-auth";
import { logAudit } from "@/lib/audit";
import { broadcast } from "@/lib/ably-server";
import type { MarketRecord } from "@/lib/api-types";

export const dynamic = "force-dynamic";

function generateMarketAddress(): string {
  const hex = Array.from({ length: 40 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join("");
  return `0x${hex}`;
}

export async function POST(req: NextRequest) {
  if (!requireApiKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Partial<MarketRecord> & { address?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate required fields
  if (!body.title || typeof body.title !== "string") {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }
  if (!body.description || typeof body.description !== "string") {
    return NextResponse.json({ error: "description required" }, { status: 400 });
  }
  if (!Array.isArray(body.outcomes) || body.outcomes.length < 2) {
    return NextResponse.json({ error: "At least 2 outcomes required" }, { status: 400 });
  }
  if (!body.closeDate || typeof body.closeDate !== "number") {
    return NextResponse.json({ error: "closeDate (unix ms) required" }, { status: 400 });
  }
  if (body.closeDate <= Date.now()) {
    return NextResponse.json({ error: "closeDate must be in the future" }, { status: 400 });
  }

  try {
    // Use provided address if valid, otherwise generate one
    let address: string;
    if (body.address && validateAddress(body.address)) {
      address = body.address.toLowerCase();
    } else {
      address = generateMarketAddress();
    }

    const market: MarketRecord = {
      address,
      title: sanitizeText(body.title, 200),
      description: sanitizeText(body.description, 1000),
      category: body.category ?? "other",
      icon: sanitizeText(body.icon ?? "📊", 8),
      createdAt: Date.now(),
      closeDate: body.closeDate,
      resolutionDate: body.resolutionDate ?? body.closeDate + 86_400_000,
      resolutionSource: sanitizeText(body.resolutionSource ?? "Manual verification", 200),
      status: "open",
      resolvedAt: null,
      outcomes: body.outcomes.map((o, i) => ({
        id: o.id ?? `outcome-${i}`,
        label: sanitizeText(o.label ?? `Option ${i + 1}`, 64),
        pool: "0",
        probability: body.outcomes!.length > 0 ? Math.round(100 / body.outcomes!.length) : 50,
        odds: body.outcomes!.length,
      })),
      winningOutcomeId: null,
      totalPool: "0",
      totalBettors: 0,
      feeCollected: "0",
      txHashCreate: body.txHashCreate ?? "0x" + "0".repeat(64),
      txHashResolve: null,
      isHot: body.isHot ?? false,
    };

    // Store in Redis
    await Promise.all([
      kv.hset(KEYS.market(address), market as unknown as Record<string, unknown>),
      kv.zadd(KEYS.markets, market.createdAt, address),
      kv.hincrby(KEYS.stats, "totalMarkets", 1),
      kv.hincrby(KEYS.stats, "marketsOpen", 1),
    ]);

    // Initialize empty odds hash
    const oddsInit: Record<string, string> = {};
    for (const o of market.outcomes) oddsInit[o.id] = "0";
    await kv.hset(KEYS.marketOdds(address), oddsInit);

    // Log audit
    await logAudit({
      event: "market_created",
      marketAddress: address,
      data: { title: market.title, category: market.category, outcomes: market.outcomes.length },
      source: "api",
      timestamp: Date.now(),
    });

    // Broadcast
    void broadcast.marketCreated({
      marketAddress: address,
      title: market.title,
      category: market.category,
    });

    return NextResponse.json({ ok: true, market }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/admin/markets]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
