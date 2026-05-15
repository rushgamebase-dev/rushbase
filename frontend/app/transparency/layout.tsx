import type { ReactNode } from "react";

export const metadata = {
  title: "Ledger — Rush",
  description: "Rush ledger for on-chain proof, game accounting, contracts and legacy holder claims.",
  openGraph: {
    title: "Rush Ledger",
    description: "On-chain proof, game accounting, contracts and legacy holder claims.",
    images: ["/og-image.png"],
    type: "website",
  },
  twitter: {
    card: "summary_large_image" as const,
    title: "Rush Ledger",
    description: "On-chain proof, game accounting, contracts and legacy holder claims.",
    images: ["/og-image.png"],
  },
};

export default function TransparencyLayout({ children }: { children: ReactNode }) {
  return children;
}
