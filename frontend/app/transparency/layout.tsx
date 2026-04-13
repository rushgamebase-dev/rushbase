import type { ReactNode } from "react";

export const metadata = {
  title: "Transparency — Rush",
  description: "Every round's evidence, SHA-256 hashes, and on-chain settlement. Verify any outcome yourself.",
  openGraph: {
    title: "Rush — Transparency Ledger",
    description: "Timestamped evidence with SHA-256 per round. Verify on Basescan.",
    images: ["/og-image.png"],
    type: "website",
  },
  twitter: {
    card: "summary_large_image" as const,
    title: "Rush — Transparency Ledger",
    description: "SHA-256 evidence per round. Fully auditable.",
    images: ["/og-image.png"],
  },
};

export default function TransparencyLayout({ children }: { children: ReactNode }) {
  return children;
}
