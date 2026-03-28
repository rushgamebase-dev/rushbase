import { NextRequest, NextResponse } from "next/server";
import { kv, KEYS } from "@/lib/redis";
import { createRateLimiter } from "@/lib/rate-limit";
import type { RoundHistoryEntry } from "@/lib/ledger";

export const dynamic = "force-dynamic";

const limiter = createRateLimiter({ max: 20, windowMs: 60_000, route: "rounds:history:get" });

// GET /api/rounds/history?limit=<n>
// Returns last N round results (most recent first).
export async function GET(req: NextRequest) {
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
    const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") || "20"), 100);

    const raw = await kv.lrange<string>(KEYS.roundsHistory, 0, limit - 1);

    const rounds: RoundHistoryEntry[] = raw.map((entry) => {
      if (typeof entry === "string") {
        try { return JSON.parse(entry); } catch { return null; }
      }
      return entry;
    }).filter(Boolean);

    return NextResponse.json({ rounds }, {
      headers: {
        "X-RateLimit-Remaining": String(rl.remaining),
        "X-RateLimit-Reset": String(rl.reset),
      },
    });
  } catch (error) {
    console.error("GET /api/rounds/history error:", error);
    return NextResponse.json({ rounds: [] });
  }
}
