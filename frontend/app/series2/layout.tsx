import type { ReactNode } from "react";

export const metadata = {
  title: "Series 2 — Founder Tiles",
  description: "Founder tier with 5x revenue weight and permanent buyout protection. Limited seats on Base.",
  openGraph: {
    title: "Rush Series 2 — Founder Tiles",
    description: "5x revenue weight. Buyout-immune. The permanent seat at the table.",
    images: ["/og-image.png"],
    type: "website",
  },
  twitter: {
    card: "summary_large_image" as const,
    title: "Rush Series 2 — Founder Tiles",
    description: "5x revenue weight. Buyout-immune. Permanent seat.",
    images: ["/og-image.png"],
  },
};

export default function Series2Layout({ children }: { children: ReactNode }) {
  return children;
}
