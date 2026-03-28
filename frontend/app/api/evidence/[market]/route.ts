import { NextRequest, NextResponse } from "next/server";
import { kv, KEYS } from "@/lib/redis";
import type { MarketRecord, EvidenceData } from "@/lib/ledger";

export const dynamic = "force-dynamic";

// Validate that a string looks like an Ethereum address (0x + 40 hex chars)
function isValidAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

// GET /api/evidence/[market] — returns evidence data for a specific market
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ market: string }> },
) {
  try {
    const { market } = await params;

    if (!isValidAddress(market)) {
      return NextResponse.json(
        { error: "Invalid market address format" },
        { status: 400 },
      );
    }

    const record = await kv.hgetall<MarketRecord>(
      KEYS.ledgerMarket(market),
    );

    if (!record) {
      return NextResponse.json(
        { error: "Market not found" },
        { status: 404 },
      );
    }

    // Evidence may be stored as a JSON string in the hash
    let evidence: EvidenceData | null = null;
    if (record.evidence) {
      if (typeof record.evidence === "string") {
        try {
          evidence = JSON.parse(record.evidence as unknown as string);
        } catch {
          evidence = null;
        }
      } else {
        evidence = record.evidence;
      }
    }

    if (!evidence) {
      return NextResponse.json(
        { error: "No evidence found for this market" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      market: market.toLowerCase(),
      evidence,
    });
  } catch (error) {
    console.error("GET /api/evidence/[market] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
