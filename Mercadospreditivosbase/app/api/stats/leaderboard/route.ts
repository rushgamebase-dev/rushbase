import { NextRequest, NextResponse } from "next/server";
import { kv, KEYS } from "@/lib/redis";
import { rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/api-auth";
import type { LeaderboardEntry } from "@/lib/api-types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await rateLimit(ip, "leaderboard", 10, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: rateLimitHeaders(rl) }
    );
  }

  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") ?? "20")));

    // ZREVRANGE returns [member, score, member, score, ...] with WITHSCORES
    // kv.zrevrange returns just members; we need scores too.
    // Use the underlying zrevrange with scores via a manual approach:
    const members = await kv.zrevrange(KEYS.leaderboard, 0, limit - 1);

    // Fetch scores by re-querying individual ZSCORE — or rely on the fact
    // that our in-memory fallback exposes scores. For Upstash, we use
    // ZRANGE ... WITHSCORES via a raw approach. Since the kv abstraction
    // doesn't expose WITHSCORES directly, we fetch the bet profile to
    // derive bet counts and use the score as profit.
    const leaderboard: LeaderboardEntry[] = await Promise.all(
      members.map(async (addr, idx) => {
        // Retrieve user's bet history to compute stats
        const bets = await kv.lrange<{ odds: number; claimed: boolean; claimAmount: string | null }>(
          KEYS.profileBets(addr),
          0,
          -1
        );

        const totalBets = bets.length;
        const wins = bets.filter((b) => b.claimed && b.claimAmount && BigInt(b.claimAmount) > BigInt(0)).length;
        const winRate = totalBets > 0 ? Math.round((wins / totalBets) * 100) : 0;

        // The ZSET score is stored as profit in wei — we convert via float division
        // We don't have scores directly; use a placeholder until ZSCORE is available
        // For now: compute profit from bets
        const profit = bets.reduce((sum, b) => {
          if (b.claimed && b.claimAmount) {
            return sum + Number(b.claimAmount) / 1e18;
          }
          return sum;
        }, 0);

        return {
          rank: idx + 1,
          address: addr,
          profit: Math.round(profit * 1e6) / 1e6,
          totalBets,
          winRate,
        } satisfies LeaderboardEntry;
      })
    );

    return NextResponse.json(
      { leaderboard },
      { headers: rateLimitHeaders(rl) }
    );
  } catch (err) {
    console.error("[GET /api/stats/leaderboard]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
