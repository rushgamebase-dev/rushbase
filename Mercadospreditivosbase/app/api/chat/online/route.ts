import { NextRequest, NextResponse } from "next/server";
import { kv, KEYS } from "@/lib/redis";
import { rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { getClientIp, validateAddress } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// Users are considered online if their heartbeat is within this window
const ONLINE_WINDOW_MS = 30_000;

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await rateLimit(ip, "chat-online", 20, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: rateLimitHeaders(rl) }
    );
  }

  try {
    const { searchParams } = new URL(req.url);
    const heartbeat = searchParams.get("heartbeat");
    const now = Date.now();

    // Register heartbeat if address provided and valid
    if (heartbeat && validateAddress(heartbeat)) {
      await kv.zadd(KEYS.chatOnline, now, heartbeat.toLowerCase());
    }

    // Prune users that have not sent a heartbeat within the window
    const cutoff = now - ONLINE_WINDOW_MS;
    await kv.zremrangebyscore(KEYS.chatOnline, "-inf", cutoff);

    // Fetch users whose score (last heartbeat) is within the window
    const onlineUsers = await kv.zrangebyscore(KEYS.chatOnline, cutoff + 1, "+inf");

    return NextResponse.json(
      { count: onlineUsers.length, users: onlineUsers },
      { headers: rateLimitHeaders(rl) }
    );
  } catch (err) {
    console.error("[GET /api/chat/online]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
