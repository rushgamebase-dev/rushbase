import type { ReactNode } from "react";

export const metadata = {
  title: "Docs — Rush",
  description: "Docs for Rush Royale, Tap Trading, Ledger and verified Base contracts.",
  openGraph: {
    title: "Rush Docs",
    description: "Royale, Tap Trading, Ledger and verified Base contracts.",
    images: ["/og-image.png"],
    type: "article",
  },
  twitter: {
    card: "summary_large_image" as const,
    title: "Rush Docs",
    description: "Royale, Tap Trading, Ledger and verified Base contracts.",
    images: ["/og-image.png"],
  },
};

export default function DocsLayout({ children }: { children: ReactNode }) {
  return children;
}
