import "./globals.css";
import Providers from "./providers";
import { Analytics } from "@vercel/analytics/next";

export const metadata = {
  title: "Rush — Live Prediction Market",
  description: "On-chain vehicle count prediction market. Bet on traffic. Win ETH.",
  openGraph: {
    title: "Rush — Live Prediction Market",
    description: "Predict vehicle counts on live cameras. Win ETH on Base Chain.",
    url: "https://rushgame.vip",
    images: ["https://rushgame.vip/og-image.png"],
    type: "website",
    siteName: "Rush Games",
  },
  twitter: {
    card: "summary_large_image",
    title: "Rush — Live Prediction Market",
    description: "Predict vehicle counts on live cameras. Win ETH on Base Chain.",
    images: ["https://rushgame.vip/og-image.png"],
    site: "@rushgamebase",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" style={{ colorScheme: "dark" }} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
