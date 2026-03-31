import { NextRequest, NextResponse } from "next/server";
import { kv, KEYS } from "@/lib/redis";
import { rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/api-auth";
import type { BetRecord } from "@/lib/api-types";
import { generateMockActivity, MOCK_MARKETS } from "@/lib/mock-data";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await rateLimit(ip, "activity", 30, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: rateLimitHeaders(rl) }
    );
  }

  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") ?? "20")));

    const activity = await kv.lrange<BetRecord>(KEYS.recentBets, 0, limit - 1);

    if (activity.length === 0) {
      // Fallback: generate mock activity from all mock markets
      const mockActivity = MOCK_MARKETS.flatMap((m) =>
        generateMockActivity(m.id, 3)
      )
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit)
        .map((a) => ({
          id: a.id,
          marketAddress: MOCK_MARKETS.find((m) => m.id === a.marketId)?.address ?? a.marketId,
          user: a.user ?? "0x0000000000000000000000000000000000000000",
          outcomeId: `outcome-${a.outcomeLabel?.toLowerCase().replace(/\s+/g, "-")}`,
          outcomeLabel: a.outcomeLabel ?? "",
          amount: String(Math.round((a.amount ?? 0) * 1e18)),
          odds: 2.0,
          txHash: a.txHash ?? "0x" + "0".repeat(64),
          timestamp: a.timestamp,
          claimed: false,
          claimAmount: null,
        } satisfies BetRecord)
      );

      return NextResponse.json(
        { activity: mockActivity },
        { headers: rateLimitHeaders(rl) }
      );
    }

    return NextResponse.json(
      { activity },
      { headers: rateLimitHeaders(rl) }
    );
  } catch (err) {
    console.error("[GET /api/activity]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
