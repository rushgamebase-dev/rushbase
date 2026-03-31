import { kv, KEYS } from "./redis";

export type AuditEventType =
  | "market_created"
  | "market_resolved"
  | "market_cancelled"
  | "bet_placed"
  | "winnings_claimed"
  | "odds_updated";

export interface AuditEvent {
  timestamp: number;
  event: AuditEventType;
  marketAddress: string;
  data: Record<string, unknown>;
  source: "oracle" | "contract" | "api" | "user";
}

export async function logAudit(event: AuditEvent): Promise<void> {
  try {
    await Promise.all([
      kv.lpush(KEYS.auditEvents, event).then(() => kv.ltrim(KEYS.auditEvents, 0, 999)),
      kv.lpush(KEYS.auditMarket(event.marketAddress), event).then(() =>
        kv.ltrim(KEYS.auditMarket(event.marketAddress), 0, 99)
      ),
    ]);
  } catch (err) {
    console.error("[audit] failed to log:", err);
  }
}

export async function getAuditLog(
  marketAddress?: string,
  limit: number = 50
): Promise<AuditEvent[]> {
  const key = marketAddress ? KEYS.auditMarket(marketAddress) : KEYS.auditEvents;
  return kv.lrange<AuditEvent>(key, 0, limit - 1);
}
