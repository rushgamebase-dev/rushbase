import { NextRequest, NextResponse } from "next/server";
import Ably from "ably";

export const dynamic = "force-dynamic";

// Token auth endpoint — frontend calls this to get a short-lived Ably token.
// This keeps the API key server-side only.
export async function GET(req: NextRequest) {
  const apiKey = process.env.ABLY_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Ably not configured" }, { status: 500 });
  }

  const address = req.nextUrl.searchParams.get("address") || "anon";
  const clientId = address.startsWith("0x")
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : "anon";

  try {
    const ably = new Ably.Rest({ key: apiKey });
    const token = await ably.auth.createTokenRequest({
      clientId,
      capability: { "rush:chat": ["publish", "subscribe", "history"] },
      ttl: 3600 * 1000, // 1 hour
    });
    return NextResponse.json(token);
  } catch (err) {
    console.error("Ably token error:", err);
    return NextResponse.json({ error: "token failed" }, { status: 500 });
  }
}
