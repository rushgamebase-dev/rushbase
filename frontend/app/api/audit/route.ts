import { NextRequest, NextResponse } from "next/server";
import { getAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

// Validate that a string looks like an Ethereum address (0x + 40 hex chars)
function isValidAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

// GET /api/audit?market=0x...&limit=50
// Returns audit events (global or per-market).
export async function GET(req: NextRequest) {
  try {
    const market = req.nextUrl.searchParams.get("market") || undefined;
    const limitParam = req.nextUrl.searchParams.get("limit");
    const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 50;

    // Validate market address if provided
    if (market && !isValidAddress(market)) {
      return NextResponse.json(
        { error: "Invalid market address format" },
        { status: 400 },
      );
    }

    const events = await getAuditLog(market, limit);

    return NextResponse.json({ events, total: events.length });
  } catch (error) {
    console.error("GET /api/audit error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
