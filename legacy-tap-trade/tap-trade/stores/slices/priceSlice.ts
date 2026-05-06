import { StateCreator } from "zustand";
import type { Asset, PriceMap } from "@/types";
import { pricesApi } from "@/lib/api";

export interface PriceSlice {
  prices: PriceMap;
  priceHistory: Record<Asset, number[]>;
  lastUpdate: number;

  updatePrice: (asset: Asset, price: number) => void;
  updatePrices: (prices: PriceMap) => void;
  fetchPrices: () => Promise<void>;
  getPrice: (asset: Asset) => number;
}

const DEFAULT_PRICES: PriceMap = {
  BTCUSDT: 0,
  ETHUSDT: 0,
  SOLUSDT: 0,
};

const MAX_HISTORY_LENGTH = 100;

export const createPriceSlice: StateCreator<PriceSlice> = (set, get) => ({
  prices: DEFAULT_PRICES,
  priceHistory: {
    BTCUSDT: [],
    ETHUSDT: [],
    SOLUSDT: [],
  },
  lastUpdate: 0,

  updatePrice: (asset, price) => {
    const { prices, priceHistory } = get();
    const history = [...priceHistory[asset], price].slice(-MAX_HISTORY_LENGTH);

    set({
      prices: { ...prices, [asset]: price },
      priceHistory: { ...priceHistory, [asset]: history },
      lastUpdate: Date.now(),
    });
  },

  updatePrices: (newPrices) => {
    const { prices, priceHistory } = get();
    const updatedHistory = { ...priceHistory };

    Object.entries(newPrices).forEach(([asset, price]) => {
      if (price > 0) {
        updatedHistory[asset as Asset] = [
          ...updatedHistory[asset as Asset],
          price,
        ].slice(-MAX_HISTORY_LENGTH);
      }
    });

    set({
      prices: { ...prices, ...newPrices },
      priceHistory: updatedHistory,
      lastUpdate: Date.now(),
    });
  },

  fetchPrices: async () => {
    try {
      const priceData = await pricesApi.getPrices();
      const priceMap: Partial<PriceMap> = {};

      priceData.forEach((p) => {
        priceMap[p.symbol] = p.price;
      });

      const { prices } = get();
      set({
        prices: { ...prices, ...priceMap },
        lastUpdate: Date.now(),
      });
    } catch (error) {
      console.error("Failed to fetch prices:", error);
    }
  },

  getPrice: (asset) => get().prices[asset] || 0,
});
