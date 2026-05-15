import "./globals.css";
import Providers from "./providers";

export const metadata = {
  metadataBase: new URL("https://rushgame.vip"),
  title: "Rush — Royale, Tap Trading and On-Chain Games",
  description: "Rush is a Base ecosystem for Royale battles, Tap Trading, ranks, stats and public ledger proof.",
  manifest: "/manifest.webmanifest",
  applicationName: "Rush",
  appleWebApp: {
    capable: true,
    title: "Rush",
    statusBarStyle: "black-translucent" as const,
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
  icons: {
    icon: "/logo.png",
    shortcut: "/logo.png",
    apple: "/logo.png",
  },
  openGraph: {
    title: "Rush — Royale, Tap Trading and On-Chain Games",
    description: "Play Rush Royale, Tap Trading and inspect every result on Base.",
    url: "https://rushgame.vip",
    images: ["/og-image.png"],
    type: "website",
    siteName: "Rush Games",
  },
  twitter: {
    card: "summary_large_image",
    title: "Rush — Royale, Tap Trading and On-Chain Games",
    description: "Play Rush Royale, Tap Trading and inspect every result on Base.",
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
      </body>
    </html>
  );
}
