import axios, { AxiosError } from "axios";
import Cookies from "js-cookie";
import type {
  Asset,
  AuthResponse,
  Balance,
  Direction,
  LeaderboardEntry,
  LedgerEntry,
  Leverage,
  Position,
  PositionWithPnL,
  PriceData,
  UserProfile,
} from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

const api = axios.create({
  baseURL: `${API_URL}/api/v1`,
  headers: {
    "Content-Type": "application/json",
  },
});

// Request interceptor to add auth token
api.interceptors.request.use((config) => {
  const token = Cookies.get("accessToken");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor for token refresh
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && originalRequest) {
      const refreshToken = Cookies.get("refreshToken");

      if (refreshToken) {
        try {
          const response = await axios.post<{ access_token: string; refresh_token: string }>(
            `${API_URL}/api/v1/auth/refresh`,
            { refresh_token: refreshToken }
          );

          const { access_token, refresh_token } = response.data;

          Cookies.set("accessToken", access_token, { expires: 1 });
          Cookies.set("refreshToken", refresh_token, { expires: 7 });

          originalRequest.headers.Authorization = `Bearer ${access_token}`;
          return api(originalRequest);
        } catch {
          // Refresh failed, clear tokens
          Cookies.remove("accessToken");
          Cookies.remove("refreshToken");
          window.location.href = "/login";
        }
      }
    }

    return Promise.reject(error);
  }
);

// Auth API
export const authApi = {
  async register(email: string, username: string, password: string): Promise<AuthResponse> {
    const response = await api.post<AuthResponse>("/auth/register", {
      email,
      username,
      password,
    });
    return {
      accessToken: response.data.accessToken || (response.data as unknown as { access_token: string }).access_token,
      refreshToken: response.data.refreshToken || (response.data as unknown as { refresh_token: string }).refresh_token,
      user: response.data.user,
    };
  },

  async login(email: string, password: string): Promise<AuthResponse> {
    const response = await api.post<AuthResponse>("/auth/login", {
      email,
      password,
    });
    return {
      accessToken: response.data.accessToken || (response.data as unknown as { access_token: string }).access_token,
      refreshToken: response.data.refreshToken || (response.data as unknown as { refresh_token: string }).refresh_token,
      user: response.data.user,
    };
  },

  async logout(): Promise<void> {
    const refreshToken = Cookies.get("refreshToken");
    if (refreshToken) {
      await api.post("/auth/logout", { refresh_token: refreshToken });
    }
    Cookies.remove("accessToken");
    Cookies.remove("refreshToken");
  },
};

// User API
export const userApi = {
  async getBalance(): Promise<Balance> {
    const response = await api.get<{
      available_balance: string;
      locked_balance: string;
      total_balance: string;
    }>("/user/balance");
    return {
      availableBalance: parseFloat(response.data.available_balance),
      lockedBalance: parseFloat(response.data.locked_balance),
      totalBalance: parseFloat(response.data.total_balance),
    };
  },

  async getProfile(): Promise<UserProfile> {
    const response = await api.get<{
      id: string;
      email: string;
      username: string;
      available_balance: string;
      locked_balance: string;
      total_wins: number;
      total_losses: number;
      win_rate: number;
      current_streak: number;
      max_streak: number;
      total_pnl: string;
      created_at: number;
    }>("/user/profile");
    return {
      id: response.data.id,
      email: response.data.email,
      username: response.data.username,
      availableBalance: parseFloat(response.data.available_balance),
      lockedBalance: parseFloat(response.data.locked_balance),
      totalWins: response.data.total_wins,
      totalLosses: response.data.total_losses,
      winRate: response.data.win_rate,
      currentStreak: response.data.current_streak,
      maxStreak: response.data.max_streak,
      totalPnl: parseFloat(response.data.total_pnl),
      createdAt: response.data.created_at,
    };
  },

  async getLedgerHistory(limit = 50, offset = 0): Promise<LedgerEntry[]> {
    const response = await api.get<{
      entries: Array<{
        id: string;
        tx_type: string;
        amount: string;
        balance_before: string;
        balance_after: string;
        reference_id?: string;
        reference_type?: string;
        description?: string;
        created_at: number;
      }>;
    }>("/user/ledger", { params: { limit, offset } });
    return response.data.entries.map((e) => ({
      id: e.id,
      txType: e.tx_type,
      amount: parseFloat(e.amount),
      balanceBefore: parseFloat(e.balance_before),
      balanceAfter: parseFloat(e.balance_after),
      referenceId: e.reference_id,
      referenceType: e.reference_type,
      description: e.description,
      createdAt: e.created_at,
    }));
  },
};

// Trading API
export const tradingApi = {
  async openPosition(
    symbol: Asset,
    side: Direction,
    stake: number,
    leverage: Leverage
  ): Promise<Position> {
    const response = await api.post<{
      id: string;
      symbol: string;
      side: string;
      status: string;
      size: string;
      leverage: number;
      margin: string;
      entry_price: string;
      effective_entry_price: string;
      liquidation_price: string;
      created_at: number;
    }>("/trading/positions", {
      symbol,
      side,
      stake: stake.toString(),
      leverage,
    });
    return {
      id: response.data.id,
      symbol: response.data.symbol as Asset,
      side: response.data.side as Direction,
      status: response.data.status as "OPEN",
      size: parseFloat(response.data.size),
      leverage: response.data.leverage as Leverage,
      margin: parseFloat(response.data.margin),
      entryPrice: parseFloat(response.data.entry_price),
      effectiveEntryPrice: parseFloat(response.data.effective_entry_price),
      liquidationPrice: parseFloat(response.data.liquidation_price),
      createdAt: response.data.created_at,
    };
  },

  async closePosition(
    positionId: string
  ): Promise<{ positionId: string; exitPrice: number; realizedPnl: number; status: string }> {
    const response = await api.delete<{
      position_id: string;
      exit_price: string;
      realized_pnl: string;
      status: string;
    }>(`/trading/positions/${positionId}`);
    return {
      positionId: response.data.position_id,
      exitPrice: parseFloat(response.data.exit_price),
      realizedPnl: parseFloat(response.data.realized_pnl),
      status: response.data.status,
    };
  },

  async getOpenPositions(): Promise<PositionWithPnL[]> {
    const response = await api.get<{
      positions: Array<{
        position: {
          id: string;
          symbol: string;
          side: string;
          status: string;
          size: string;
          leverage: number;
          margin: string;
          entry_price: string;
          effective_entry_price: string;
          liquidation_price: string;
          created_at: number;
        };
        current_price: string;
        unrealized_pnl: string;
        roe_percent: string;
        margin_ratio: string;
        distance_to_liq_percent: string;
      }>;
    }>("/trading/positions");
    return response.data.positions.map((p) => ({
      id: p.position.id,
      symbol: p.position.symbol as Asset,
      side: p.position.side as Direction,
      status: p.position.status as "OPEN",
      size: parseFloat(p.position.size),
      leverage: p.position.leverage as Leverage,
      margin: parseFloat(p.position.margin),
      entryPrice: parseFloat(p.position.entry_price),
      effectiveEntryPrice: parseFloat(p.position.effective_entry_price),
      liquidationPrice: parseFloat(p.position.liquidation_price),
      createdAt: p.position.created_at,
      currentPrice: parseFloat(p.current_price),
      unrealizedPnl: parseFloat(p.unrealized_pnl),
      roePercent: parseFloat(p.roe_percent),
      marginRatio: parseFloat(p.margin_ratio),
      distanceToLiqPercent: parseFloat(p.distance_to_liq_percent),
    }));
  },

  async getPositionHistory(limit = 50, offset = 0): Promise<Position[]> {
    const response = await api.get<{
      positions: Array<{
        id: string;
        symbol: string;
        side: string;
        status: string;
        size: string;
        leverage: number;
        margin: string;
        entry_price: string;
        effective_entry_price: string;
        liquidation_price: string;
        created_at: number;
      }>;
    }>("/trading/history", { params: { limit, offset } });
    return response.data.positions.map((p) => ({
      id: p.id,
      symbol: p.symbol as Asset,
      side: p.side as Direction,
      status: p.status as "CLOSED" | "LIQUIDATED",
      size: parseFloat(p.size),
      leverage: p.leverage as Leverage,
      margin: parseFloat(p.margin),
      entryPrice: parseFloat(p.entry_price),
      effectiveEntryPrice: parseFloat(p.effective_entry_price),
      liquidationPrice: parseFloat(p.liquidation_price),
      createdAt: p.created_at,
    }));
  },
};

// Prices API
export const pricesApi = {
  async getPrices(): Promise<PriceData[]> {
    const response = await api.get<{
      prices: Array<{
        symbol: string;
        price: string;
        timestamp: number;
      }>;
    }>("/prices");
    return response.data.prices.map((p) => ({
      symbol: p.symbol as Asset,
      price: parseFloat(p.price),
      timestamp: p.timestamp,
    }));
  },

  async getSymbols(): Promise<
    Array<{
      symbol: Asset;
      base: string;
      quote: string;
      leverages: Leverage[];
    }>
  > {
    const response = await api.get<{
      symbols: Array<{
        symbol: string;
        base: string;
        quote: string;
        leverages: number[];
      }>;
    }>("/prices/symbols");
    return response.data.symbols.map((s) => ({
      symbol: s.symbol as Asset,
      base: s.base,
      quote: s.quote,
      leverages: s.leverages as Leverage[],
    }));
  },
};

// Leaderboard API
export const leaderboardApi = {
  async getLeaderboard(
    period: "daily" | "weekly" | "all_time" = "all_time",
    limit = 100
  ): Promise<LeaderboardEntry[]> {
    const response = await api.get<{
      entries: Array<{
        rank: number;
        username: string;
        total_pnl: string;
        win_rate: number;
        total_trades: number;
      }>;
    }>("/leaderboard", { params: { period, limit } });
    return response.data.entries.map((e) => ({
      rank: e.rank,
      username: e.username,
      totalPnl: parseFloat(e.total_pnl),
      winRate: e.win_rate,
      totalTrades: e.total_trades,
    }));
  },
};

export default api;
