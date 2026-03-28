import { NextRequest, NextResponse } from "next/server";
import { kv } from "@/lib/redis";

export const dynamic = "force-dynamic";

// GET /api/oracle-url — Returns current oracle WebSocket URL
export async function GET() {
  try {
    const url = await kv.get<string>("oracle:ws_url");
    return NextResponse.json({ url: url || "" });
  } catch {
    return NextResponse.json({ url: "" });
  }
}

// POST /api/oracle-url — Set oracle WebSocket URL (called by start script)
export async function POST(req: NextRequest) {
  try {
    const apiKey = req.headers.get("x-api-key");
    const expectedKey = process.env.LEDGER_API_KEY;
    if (expectedKey && apiKey !== expectedKey) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { url } = await req.json();
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "url required" }, { status: 400 });
    }

    await kv.set("oracle:ws_url", url);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/oracle-url error:", err);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
