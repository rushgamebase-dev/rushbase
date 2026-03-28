import { kv } from "@/lib/redis";

// ─── Audit Types ─────────────────────────────────────────────────────────────

export type AuditEventType =
  | "market_created"
  | "market_resolved"
  | "market_cancelled"
  | "bet_placed"
  | "winnings_claimed"
  | "evidence_stored";

export interface AuditEvent {
  timestamp: number;
  event: AuditEventType;
  marketAddress: string;
  data: Record<string, unknown>;
  source: "oracle" | "contract" | "api";
}

// ─── Keys ────────────────────────────────────────────────────────────────────

const AUDIT_GLOBAL_KEY = "audit:events";
const MAX_GLOBAL_EVENTS = 1000;
const MAX_MARKET_EVENTS = 100;

function marketAuditKey(address: string): string {
  return `audit:market:${address.toLowerCase()}`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Log an audit event. Stored in both the global list and the per-market list.
 * Lists are capped to prevent unbounded growth.
 */
export async function logAudit(event: AuditEvent): Promise<void> {
  const payload = JSON.stringify(event);
  const addr = event.marketAddress.toLowerCase();

  // Push to global list (most recent first)
  await kv.lpush(AUDIT_GLOBAL_KEY, payload);
  await kv.ltrim(AUDIT_GLOBAL_KEY, 0, MAX_GLOBAL_EVENTS - 1);

  // Push to per-market list
  const mKey = marketAuditKey(addr);
  await kv.lpush(mKey, payload);
  await kv.ltrim(mKey, 0, MAX_MARKET_EVENTS - 1);
}

/**
 * Retrieve audit events.
 *
 * @param marketAddress - If provided, return events for that market only.
 *                        Otherwise return global recent events.
 * @param limit         - Max events to return (default 50, max 200).
 */
export async function getAuditLog(
  marketAddress?: string,
  limit: number = 50,
): Promise<AuditEvent[]> {
  const cap = Math.min(Math.max(limit, 1), 200);
  const key = marketAddress
    ? marketAuditKey(marketAddress)
    : AUDIT_GLOBAL_KEY;

  const raw = await kv.lrange<string>(key, 0, cap - 1);

  const events: AuditEvent[] = [];
  for (const item of raw) {
    try {
      const parsed: AuditEvent =
        typeof item === "string" ? JSON.parse(item) : (item as unknown as AuditEvent);
      events.push(parsed);
    } catch {
      // skip malformed entries
    }
  }

  return events;
}
