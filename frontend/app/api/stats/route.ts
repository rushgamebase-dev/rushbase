import { NextResponse } from "next/server";
import { kv, KEYS } from "@/lib/redis";

export const dynamic = "force-dynamic";

// GET /api/stats — Aggregated platform statistics.
export async function GET() {
  const raw = await kv.hgetall<Record<string, string>>(KEYS.stats);

  const totalVolume = parseFloat(raw?.totalVolume || "0");
  const marketsResolved = parseInt(raw?.marketsResolved || "0", 10);
  const totalBettors = parseInt(raw?.totalBettors || "0", 10);
  const feesCollected = parseFloat(raw?.feesCollected || "0");
  const biggestRound = parseFloat(raw?.biggestRound || "0");

  const avgPoolSize = marketsResolved > 0 ? totalVolume / marketsResolved : 0;
  const avgBettorsPerRound = marketsResolved > 0 ? Math.round(totalBettors / marketsResolved) : 0;

  // TODO: 24h volume requires time-windowed tracking. For now approximate from total.
  const volume24h = 0;

  return NextResponse.json({
    totalVolume: Math.round(totalVolume * 1000) / 1000,
    marketsResolved,
    uniqueBettors: totalBettors,
    feesDistributed: Math.round(feesCollected * 1000) / 1000,
    avgPoolSize: Math.round(avgPoolSize * 1000) / 1000,
    biggestRound: Math.round(biggestRound * 1000) / 1000,
    avgBettorsPerRound,
    volume24h,
  });
}
