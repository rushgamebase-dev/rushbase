// Trading types
export type Asset = "BTCUSDT" | "ETHUSDT" | "SOLUSDT";
export type Direction = "LONG" | "SHORT";
export type Leverage = 10 | 25 | 50 | 100;
export type PositionStatus = "OPEN" | "CLOSED" | "LIQUIDATED";

// User types
export interface User {
  id: string;
  email: string;
  username: string;
  availableBalance: number;
  lockedBalance: number;
}

export interface UserProfile extends User {
  totalWins: number;
  totalLosses: number;
  winRate: number;
  currentStreak: number;
  maxStreak: number;
  totalPnl: number;
  createdAt: number;
}

// Balance types
export interface Balance {
  availableBalance: number;
  lockedBalance: number;
  totalBalance: number;
}

// Position types
export interface Position {
  id: string;
  symbol: Asset;
  side: Direction;
  status: PositionStatus;
  size: number;
  leverage: Leverage;
  margin: number;
  entryPrice: number;
  effectiveEntryPrice: number;
  liquidationPrice: number;
  createdAt: number;
}

export interface PositionWithPnL extends Position {
  currentPrice: number;
  unrealizedPnl: number;
  roePercent: number;
  marginRatio: number;
  distanceToLiqPercent: number;
}

export interface ClosedPosition extends Position {
  exitPrice: number;
  realizedPnl: number;
}

// Price types
export interface PriceData {
  symbol: Asset;
  price: number;
  timestamp: number;
}

export type PriceMap = Record<Asset, number>;

// Leaderboard types
export interface LeaderboardEntry {
  rank: number;
  username: string;
  totalPnl: number;
  winRate: number;
  totalTrades: number;
}

// Ledger types
export interface LedgerEntry {
  id: string;
  txType: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  referenceId?: string;
  referenceType?: string;
  description?: string;
  createdAt: number;
}

// API Response types
export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface ApiError {
  code: string;
  message: string;
}

// WebSocket message types
export interface WsMessage {
  type: string;
  payload?: unknown;
}

export interface WsPriceUpdate {
  type: "PriceUpdate";
  payload: {
    symbol: string;
    price: string;
    timestamp: number;
  };
}

export interface WsPnLUpdate {
  type: "PnLUpdate";
  payload: {
    positions: Array<{
      position_id: string;
      current_price: string;
      unrealized_pnl: string;
      roe_percent: string;
      margin_ratio: string;
      distance_to_liq_percent: string;
    }>;
    timestamp: number;
  };
}

export interface WsPositionOpened {
  type: "PositionOpened";
  payload: {
    position: {
      id: string;
      symbol: string;
      side: string;
      size: string;
      leverage: number;
      margin: string;
      entry_price: string;
      liquidation_price: string;
      entry_timestamp: number;
    };
  };
}

export interface WsPositionClosed {
  type: "PositionClosed";
  payload: {
    position_id: string;
    exit_price: string;
    realized_pnl: string;
    status: string;
  };
}

export interface WsBalanceUpdate {
  type: "BalanceUpdate";
  payload: {
    available_balance: string;
    locked_balance: string;
    total_balance: string;
  };
}

export interface WsAuthResult {
  type: "AuthResult";
  payload: {
    success: boolean;
    user_id?: string;
    error?: string;
  };
}

export type WsServerMessage =
  | WsPriceUpdate
  | WsPnLUpdate
  | WsPositionOpened
  | WsPositionClosed
  | WsBalanceUpdate
  | WsAuthResult
  | { type: "Subscribed"; payload: { channel: string } }
  | { type: "Unsubscribed"; payload: { channel: string } }
  | { type: "Pong"; payload: { timestamp: number; server_time: number } }
  | { type: "Error"; payload: { code: string; message: string } };
