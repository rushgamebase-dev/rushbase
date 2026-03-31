import { NextRequest, NextResponse } from "next/server";
import { getAuditLog } from "@/lib/audit";
import { rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { getClientIp, validateAddress } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = await rateLimit(ip, "audit", 10, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: rateLimitHeaders(rl) }
    );
  }

  try {
    const { searchParams } = new URL(req.url);
    const market = searchParams.get("market") ?? undefined;
    const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? "50")));

    if (market && !validateAddress(market)) {
      return NextResponse.json({ error: "Invalid market address" }, { status: 400 });
    }

    const events = await getAuditLog(market, limit);

    return NextResponse.json(
      { events, total: events.length },
      { headers: rateLimitHeaders(rl) }
    );
  } catch (err) {
    console.error("[GET /api/audit]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
