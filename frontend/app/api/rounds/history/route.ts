import { NextRequest, NextResponse } from "next/server";
import { kv, KEYS } from "@/lib/redis";
import type { RoundHistoryEntry } from "@/lib/ledger";

// GET /api/rounds/history?limit=<n>
// Returns last N round results (most recent first).
export async function GET(req: NextRequest) {
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") || "20"), 100);

  const raw = await kv.lrange<string>(KEYS.roundsHistory, 0, limit - 1);

  const rounds: RoundHistoryEntry[] = raw.map((entry) => {
    if (typeof entry === "string") {
      try { return JSON.parse(entry); } catch { return null; }
    }
    return entry;
  }).filter(Boolean);

  return NextResponse.json({ rounds });
}
