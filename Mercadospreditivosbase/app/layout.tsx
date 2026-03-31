import "./globals.css";
import Providers from "./providers";

export const metadata = {
  title: "Rush Markets — Prediction Markets on Base",
  description: "On-chain prediction markets on Base. Bet on the future of Base Chain.",
  openGraph: {
    title: "Rush Markets — Prediction Markets on Base",
    description: "On-chain prediction markets on Base Chain. Bet on real events.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Rush Markets — Prediction Markets on Base",
    description: "On-chain prediction markets on Base Chain.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
