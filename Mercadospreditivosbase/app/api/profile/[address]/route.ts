import { NextRequest, NextResponse } from "next/server";
import { kv, KEYS } from "@/lib/redis";
import { rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { getClientIp, validateAddress } from "@/lib/api-auth";
import type { BetRecord, ProfileData } from "@/lib/api-types";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { address: string } }
) {
  const ip = getClientIp(req);
  const rl = await rateLimit(ip, "profile", 10, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: rateLimitHeaders(rl) }
    );
  }

  const address = params.address?.toLowerCase();
  if (!address || !validateAddress(address)) {
    return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
  }

  try {
    const bets = await kv.lrange<BetRecord>(KEYS.profileBets(address), 0, -1);

    const totalBets = bets.length;
    const wins = bets.filter(
      (b) => b.claimed && b.claimAmount && BigInt(b.claimAmount) > BigInt(0)
    ).length;
    const losses = bets.filter(
      (b) => b.claimed && (!b.claimAmount || BigInt(b.claimAmount) === BigInt(0))
    ).length;
    const winRate = totalBets > 0 ? Math.round((wins / totalBets) * 100) : 0;

    const totalWageredWei = bets.reduce((sum, b) => {
      try {
        return sum + BigInt(b.amount ?? "0");
      } catch {
        return sum;
      }
    }, BigInt(0));

    const totalClaimedWei = bets.reduce((sum, b) => {
      try {
        if (b.claimAmount) return sum + BigInt(b.claimAmount);
        return sum;
      } catch {
        return sum;
      }
    }, BigInt(0));

    const pnlWei = totalClaimedWei - totalWageredWei;
    const totalWageredEth = Number(totalWageredWei) / 1e18;
    const pnlEth = Number(pnlWei) / 1e18;

    const profile: ProfileData = {
      address,
      totalBets,
      wins,
      losses,
      winRate,
      totalWagered: Math.round(totalWageredEth * 1e8) / 1e8,
      totalPnl: Math.round(pnlEth * 1e8) / 1e8,
      bets,
      // Legacy fields
      totalWagered_wei: totalWageredWei.toString(),
      pnl_wei: pnlWei.toString(),
      recentBets: bets.slice(0, 20),
      updatedAt: Date.now(),
    };

    return NextResponse.json(
      { profile },
      { headers: rateLimitHeaders(rl) }
    );
  } catch (err) {
    console.error("[GET /api/profile/[address]]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
