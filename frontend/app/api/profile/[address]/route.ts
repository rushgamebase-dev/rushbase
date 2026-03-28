import { NextRequest, NextResponse } from "next/server";
import { kv, KEYS } from "@/lib/redis";
import { createRateLimiter } from "@/lib/rate-limit";
import { validateAddress } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ max: 10, windowMs: 60_000, route: "profile:get" });

interface ProfileBet {
  user: string;
  rangeIndex: number;
  rangeLabel: string;
  amount: string;
  txHash: string;
  timestamp: number;
  claimed: boolean;
  claimAmount: string | null;
  marketAddress: string;
  marketDescription: string;
  threshold: number;
  actualCount: number | null;
  marketState: string;
  resolvedAt: number | null;
}

// GET /api/profile/[address]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
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
    const { address } = await params;

    if (!address || !validateAddress(address)) {
      return NextResponse.json({ error: "invalid address" }, { status: 400 });
    }

    const addr = address.toLowerCase();
    const raw = await kv.lrange<string>(KEYS.profileBets(addr), 0, 199);

    const bets: ProfileBet[] = raw.map((entry) => {
      if (typeof entry === "string") {
        try { return JSON.parse(entry); } catch { return null; }
      }
      return entry;
    }).filter(Boolean);

    // Calculate stats
    let wins = 0;
    let losses = 0;
    let totalPnl = 0;

    for (const bet of bets) {
      if (bet.marketState !== "resolved") continue;
      const amount = parseFloat(bet.amount) || 0;
      if (bet.claimed && bet.claimAmount) {
        const claim = parseFloat(bet.claimAmount) || 0;
        totalPnl += claim - amount;
        wins++;
      } else if (bet.marketState === "resolved") {
        totalPnl -= amount;
        losses++;
      }
    }

    const totalBets = bets.length;
    const decided = wins + losses;
    const winRate = decided > 0 ? Math.round((wins / decided) * 100) : 0;

    return NextResponse.json({
      address: addr,
      shortAddress: `${addr.slice(0, 6)}...${addr.slice(-4)}`,
      totalBets,
      wins,
      losses,
      winRate,
      totalPnl: Math.round(totalPnl * 10000) / 10000,
      tilesOwned: 0, // Read from contract on frontend
      bets,
    }, {
      headers: {
        "X-RateLimit-Remaining": String(rl.remaining),
        "X-RateLimit-Reset": String(rl.reset),
      },
    });
  } catch (error) {
    console.error("GET /api/profile/[address] error:", error);
    return NextResponse.json({
      address: "",
      shortAddress: "",
      totalBets: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalPnl: 0,
      tilesOwned: 0,
      bets: [],
    });
  }
}
