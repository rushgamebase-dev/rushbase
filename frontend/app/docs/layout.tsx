import type { ReactNode } from "react";

export const metadata = {
  title: "Docs — Rush Protocol",
  description: "How Rush works: live cameras, AI count, 95% to winners, 5% to tile holders, zero protocol edge.",
  openGraph: {
    title: "Rush Protocol — How it works",
    description: "Pari-mutuel prediction market on real-world traffic. 95% to winners, 5% to tile holders. Fully on-chain.",
    images: ["/og-image.png"],
    type: "article",
  },
  twitter: {
    card: "summary_large_image" as const,
    title: "Rush Protocol — How it works",
    description: "Pari-mutuel. 95/5. Fully on-chain. No house edge.",
    images: ["/og-image.png"],
  },
};

export default function DocsLayout({ children }: { children: ReactNode }) {
  return children;
}
