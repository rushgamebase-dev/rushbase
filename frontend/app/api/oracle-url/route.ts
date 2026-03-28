import { NextRequest, NextResponse } from "next/server";
import { kv } from "@/lib/redis";
import { createRateLimiter } from "@/lib/rate-limit";
import { requireApiKey } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const getLimiter = createRateLimiter({ max: 20, windowMs: 60_000, route: "oracle-url:get" });
const postLimiter = createRateLimiter({ max: 5, windowMs: 60_000, route: "oracle-url:post" });

// GET /api/oracle-url — Returns current oracle WebSocket URL
export async function GET(req: NextRequest) {
  const rl = await getLimiter.check(req);
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
    const url = await kv.get<string>("oracle:ws_url");
    return NextResponse.json({ url: url || "" }, {
      headers: {
        "X-RateLimit-Remaining": String(rl.remaining),
        "X-RateLimit-Reset": String(rl.reset),
      },
    });
  } catch {
    return NextResponse.json({ url: "" });
  }
}

// POST /api/oracle-url — Set oracle WebSocket URL (called by start script)
export async function POST(req: NextRequest) {
  // API key required
  if (!requireApiKey(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rl = await postLimiter.check(req);
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
    const { url } = await req.json();
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "url required" }, { status: 400 });
    }

    await kv.set("oracle:ws_url", url);
    return NextResponse.json({ ok: true }, {
      headers: {
        "X-RateLimit-Remaining": String(rl.remaining),
        "X-RateLimit-Reset": String(rl.reset),
      },
    });
  } catch (err) {
    console.error("POST /api/oracle-url error:", err);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
