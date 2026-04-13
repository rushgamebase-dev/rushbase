import type { ReactNode } from "react";

export const metadata = {
  title: "Tiles — Rush",
  description: "100 tiles. Own one, earn 5% of every round's pool. Harberger-taxed on Base.",
  openGraph: {
    title: "Rush Tiles — Own a seat, earn every round",
    description: "100 Harberger-taxed tiles. 5% of every prediction market fee flows to holders. Anyone can buy you out at your declared price.",
    images: ["/og-image.png"],
    type: "website",
  },
  twitter: {
    card: "summary_large_image" as const,
    title: "Rush Tiles — Own a seat, earn every round",
    description: "100 Harberger-taxed tiles. 5% of every fee to holders.",
    images: ["/og-image.png"],
  },
};

export default function TilesLayout({ children }: { children: ReactNode }) {
  return children;
}
