"use client";

import "./globals.css";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "@/lib/wagmi";
import { useState } from "react";
import Chat from "@/components/Chat";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <html lang="en" style={{ colorScheme: "dark" }}>
      <head>
        <title>Rush — Live Prediction Market</title>
        <meta name="description" content="On-chain vehicle count prediction market. Bet on traffic. Win ETH." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body>
        <WagmiProvider config={wagmiConfig}>
          <QueryClientProvider client={queryClient}>
            {children}
            {/*
              Global floating chat button — visible on mobile across ALL pages.
              The desktop sidebar version is rendered inside the home page 3-column layout.
              Chat state (messages) resets on hard navigation but persists during
              client-side routing because this component lives in the layout tree.
            */}
            <div className="md:hidden" aria-label="Global chat">
              <Chat />
            </div>
          </QueryClientProvider>
        </WagmiProvider>
      </body>
    </html>
  );
}
