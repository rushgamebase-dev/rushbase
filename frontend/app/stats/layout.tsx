import type { ReactNode } from "react";

export const metadata = {
  title: "Stats — Rush",
  description: "Rush ecosystem stats for Royale, Tap Trading, prediction markets and verified contracts.",
  openGraph: {
    title: "Rush — Ecosystem Stats",
    description: "Royale, Tap Trading, prediction markets and verified contracts.",
    images: ["/og-image.png"],
    type: "website",
  },
  twitter: {
    card: "summary_large_image" as const,
    title: "Rush — Ecosystem Stats",
    description: "Royale, Tap Trading, prediction markets and verified contracts.",
    images: ["/og-image.png"],
  },
};

export default function StatsLayout({ children }: { children: ReactNode }) {
  return children;
}
