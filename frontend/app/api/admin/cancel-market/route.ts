import { NextRequest, NextResponse } from "next/server";
import { requireApiKey, validateAddress } from "@/lib/api-auth";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/cancel-market
 *
 * Records an audit event for a market cancellation that was executed on-chain
 * by the admin via the frontend's useWriteContract hook. This endpoint does NOT
 * perform the on-chain cancellation itself — that is done by the admin wallet
 * calling cancelMarket() directly on the contract.
 *
 * Body: { marketAddress: string }
 * Headers: x-api-key required (LEDGER_API_KEY env var)
 *
 * Returns: { ok: true }
 */
export async function POST(req: NextRequest) {
  // Require API key
  if (!requireApiKey(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { marketAddress?: string; txHash?: string; cancelledBy?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { marketAddress, txHash, cancelledBy } = body;

  // Validate market address
  if (!marketAddress || typeof marketAddress !== "string") {
    return NextResponse.json(
      { error: "marketAddress is required" },
      { status: 400 },
    );
  }
  if (!validateAddress(marketAddress)) {
    return NextResponse.json(
      { error: "marketAddress must be a valid Ethereum address (0x + 40 hex chars)" },
      { status: 400 },
    );
  }

  // Validate optional cancelledBy address
  if (cancelledBy && !validateAddress(cancelledBy)) {
    return NextResponse.json(
      { error: "cancelledBy must be a valid Ethereum address if provided" },
      { status: 400 },
    );
  }

  const normalizedAddr = marketAddress.toLowerCase();

  // Log audit event — best-effort, never rejects the request
  try {
    await logAudit({
      timestamp: Date.now(),
      event: "market_cancelled",
      marketAddress: normalizedAddr,
      data: {
        txHash: txHash ?? null,
        cancelledBy: cancelledBy?.toLowerCase() ?? null,
        cancelledVia: "admin_panel",
      },
      source: "api",
    });
  } catch (auditErr) {
    // Audit failures are non-fatal — log and continue
    console.error("POST /api/admin/cancel-market audit error (non-fatal):", auditErr);
  }

  return NextResponse.json({ ok: true });
}
