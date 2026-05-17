"use client";

export type RealTapTradeSymbol = "ETHUSDT" | "BTCUSDT" | "SOLUSDT";

export type TapTradeAsset = {
  symbol: RealTapTradeSymbol;
  displaySymbol: string;
  label: string;
  priceStepUsd: number;
  defaultPrice: number;
  accent: string;
};

export const TAP_TRADE_ASSETS: TapTradeAsset[] = [
  {
    symbol: "ETHUSDT",
    displaySymbol: "ETH/USD",
    label: "Ethereum",
    priceStepUsd: 0.5,
    defaultPrice: 3_000,
    accent: "#627eea",
  },
  {
    symbol: "BTCUSDT",
    displaySymbol: "BTC/USD",
    label: "Bitcoin",
    priceStepUsd: 10,
    defaultPrice: 65_000,
    accent: "#f7931a",
  },
  {
    symbol: "SOLUSDT",
    displaySymbol: "SOL/USD",
    label: "Solana",
    priceStepUsd: 0.05,
    defaultPrice: 150,
    accent: "#14f195",
  },
];

export const DEFAULT_TAP_TRADE_ASSET = TAP_TRADE_ASSETS[0];

export function getTapTradeAsset(symbol: string): TapTradeAsset {
  return TAP_TRADE_ASSETS.find((asset) => asset.symbol === symbol) ?? DEFAULT_TAP_TRADE_ASSET;
}
