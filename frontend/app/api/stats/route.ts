import { NextResponse } from "next/server";
import { kv, KEYS } from "@/lib/redis";

export const dynamic = "force-dynamic";

// GET /api/stats — Aggregated platform statistics.
export async function GET() {
  try {
    const raw = await kv.hgetall<Record<string, string>>(KEYS.stats);

    const totalVolume = parseFloat(raw?.totalVolume || "0");
    const marketsResolved = parseInt(raw?.marketsResolved || "0", 10);
    const totalBettors = parseInt(raw?.totalBettors || "0", 10);
    const feesCollected = parseFloat(raw?.feesCollected || "0");
    const biggestRound = parseFloat(raw?.biggestRound || "0");

    const avgPoolSize = marketsResolved > 0 ? totalVolume / marketsResolved : 0;
    const avgBettorsPerRound = marketsResolved > 0 ? Math.round(totalBettors / marketsResolved) : 0;

    return NextResponse.json({
      totalVolume: Math.round(totalVolume * 1000) / 1000,
      marketsResolved,
      uniqueBettors: totalBettors,
      feesDistributed: Math.round(feesCollected * 1000) / 1000,
      avgPoolSize: Math.round(avgPoolSize * 1000) / 1000,
      biggestRound: Math.round(biggestRound * 1000) / 1000,
      avgBettorsPerRound,
      volume24h: 0,
    });
  } catch (err) {
    console.error("stats error:", err);
    return NextResponse.json({
      totalVolume: 0, marketsResolved: 0, uniqueBettors: 0,
      feesDistributed: 0, avgPoolSize: 0, biggestRound: 0,
      avgBettorsPerRound: 0, volume24h: 0,
    });
  }
}
