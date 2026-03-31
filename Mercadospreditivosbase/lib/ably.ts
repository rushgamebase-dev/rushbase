export const CHANNELS = {
  BETS: "mercados:bets",
  MARKET_EVENTS: "mercados:markets",
} as const;

export const EVENTS = {
  BET_PLACED: "bet_placed",
  MARKET_CREATED: "market_created",
  MARKET_RESOLVED: "market_resolved",
  MARKET_CANCELLED: "market_cancelled",
  ODDS_UPDATED: "odds_updated",
} as const;
