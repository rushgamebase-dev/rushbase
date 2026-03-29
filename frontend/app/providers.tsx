"use client";

import { useState, useEffect } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "@/lib/wagmi";
import Chat from "@/components/Chat";

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
        {mounted && (
          <div className="md:hidden" aria-label="Global chat">
            <Chat />
          </div>
        )}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
