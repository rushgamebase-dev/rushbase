import { NextRequest, NextResponse } from "next/server";
import { kv, KEYS } from "@/lib/redis";
import { createRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const ONLINE_WINDOW_MS = 30_000; // 30 seconds
const limiter = createRateLimiter({ max: 20, windowMs: 60_000, route: "chat:online:get" });

// GET /api/chat/online
// Returns count of users active in the last 30s.
// Also accepts ?heartbeat=<address> to register presence.
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
    const address = req.nextUrl.searchParams.get("heartbeat");
    const now = Date.now();

    // Register heartbeat if address provided
    if (address && /^0x[a-fA-F0-9]{40}$/.test(address)) {
      await kv.zadd(KEYS.chatOnline, now, address.toLowerCase());
    }

    // Clean up stale entries (older than 30s)
    await kv.zremrangebyscore(KEYS.chatOnline, 0, now - ONLINE_WINDOW_MS);

    // Count active users
    const count = await kv.zcard(KEYS.chatOnline);

    return NextResponse.json({ online: count }, {
      headers: {
        "X-RateLimit-Remaining": String(rl.remaining),
        "X-RateLimit-Reset": String(rl.reset),
      },
    });
  } catch (error) {
    console.error("GET /api/chat/online error:", error);
    return NextResponse.json({ online: 0 });
  }
}
