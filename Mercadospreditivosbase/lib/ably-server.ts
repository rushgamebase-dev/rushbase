import Ably from "ably";
import { CHANNELS, EVENTS } from "./ably";

let _ably: Ably.Rest | null = null;

function getAbly(): Ably.Rest | null {
  if (_ably) return _ably;
  const key = process.env.ABLY_API_KEY;
  if (!key) return null;
  _ably = new Ably.Rest({ key });
  return _ably;
}

export async function publishEvent(
  channel: string,
  event: string,
  data: unknown
): Promise<void> {
  const ably = getAbly();
  if (!ably) {
    console.debug("[ably] no API key, skipping publish");
    return;
  }
  try {
    const ch = ably.channels.get(channel);
    await ch.publish(event, data);
  } catch (err) {
    console.error("[ably] publish failed:", err);
  }
}

// Convenience broadcast helpers
export const broadcast = {
  betPlaced: (data: {
    marketAddress: string;
    user: string;
    outcomeLabel: string;
    amount: string;
    odds: number;
    txHash: string;
  }) => publishEvent(CHANNELS.BETS, EVENTS.BET_PLACED, data),

  oddsUpdated: (data: {
    marketAddress: string;
    outcomes: { id: string; pool: string; probability: number; odds: number }[];
    totalPool: string;
  }) => publishEvent(CHANNELS.MARKET_EVENTS, EVENTS.ODDS_UPDATED, data),

  marketCreated: (data: {
    marketAddress: string;
    title: string;
    category: string;
  }) => publishEvent(CHANNELS.MARKET_EVENTS, EVENTS.MARKET_CREATED, data),

  marketResolved: (data: {
    marketAddress: string;
    winningOutcomeId: string;
    winningLabel: string;
  }) => publishEvent(CHANNELS.MARKET_EVENTS, EVENTS.MARKET_RESOLVED, data),

  marketCancelled: (data: {
    marketAddress: string;
    reason?: string;
  }) => publishEvent(CHANNELS.MARKET_EVENTS, EVENTS.MARKET_CANCELLED, data),

  statsUpdated: (data: {
    totalVolume: number;
    marketsOpen: number;
    bets24h: number;
  }) => publishEvent(CHANNELS.MARKET_EVENTS, "stats_updated", data),
};
