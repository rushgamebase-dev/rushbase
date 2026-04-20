import "./globals.css";
import Providers from "./providers";
import { Analytics } from "@vercel/analytics/next";

export const metadata = {
  metadataBase: new URL("https://rushgame.vip"),
  title: "Rush — Live Prediction Market",
  description: "On-chain vehicle count prediction market. Bet on traffic. Win ETH.",
  manifest: "/manifest.webmanifest",
  applicationName: "Rush",
  appleWebApp: {
    capable: true,
    title: "Rush",
    statusBarStyle: "black-translucent" as const,
  },
  icons: {
    icon: "/logo.png",
    shortcut: "/logo.png",
    apple: "/logo.png",
  },
  openGraph: {
    title: "Rush — Live Prediction Market",
    description: "Predict vehicle counts on live cameras. Win ETH on Base Chain.",
    url: "https://rushgame.vip",
    images: ["/og-image.png"],
    type: "website",
    siteName: "Rush Games",
  },
  twitter: {
    card: "summary_large_image",
    title: "Rush — Live Prediction Market",
    description: "Predict vehicle counts on live cameras. Win ETH on Base Chain.",
    images: ["/og-image.png"],
    site: "@rushgamebase",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0a",
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
