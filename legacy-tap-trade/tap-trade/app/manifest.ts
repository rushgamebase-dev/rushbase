import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TapTrading - Gamified Crypto Trading",
    short_name: "TapTrading",
    description: "Trade BTC, ETH, SOL with leverage. Tap UP or DOWN and win!",
    start_url: "/trade",
    display: "standalone",
    background_color: "#0a0a0b",
    theme_color: "#22c55e",
    orientation: "portrait",
    icons: [
      {
        src: "/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
    shortcuts: [
      {
        name: "Trade",
        short_name: "Trade",
        description: "Open trading page",
        url: "/trade",
        icons: [{ src: "/icon-96x96.png", sizes: "96x96" }],
      },
      {
        name: "Dashboard",
        short_name: "Stats",
        description: "View your stats",
        url: "/dashboard",
        icons: [{ src: "/icon-96x96.png", sizes: "96x96" }],
      },
    ],
    categories: ["finance", "games"],
  };
}
