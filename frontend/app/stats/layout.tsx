import type { ReactNode } from "react";

export const metadata = {
  title: "Stats — Rush",
  description: "Live volume, fees distributed to holders, markets resolved. On-chain verifiable.",
  openGraph: {
    title: "Rush — Live Protocol Stats",
    description: "Volume, fees distributed, rounds resolved. All on-chain.",
    images: ["/og-image.png"],
    type: "website",
  },
  twitter: {
    card: "summary_large_image" as const,
    title: "Rush — Live Protocol Stats",
    description: "Volume, fees distributed, rounds resolved.",
    images: ["/og-image.png"],
  },
};

export default function StatsLayout({ children }: { children: ReactNode }) {
  return children;
}
