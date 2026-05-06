"use client";

import { useState } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "@/lib/wagmi";
import ChainGuard from "@/components/ChainGuard";
import { SoundManagerProvider } from "@/components/gamification";

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ChainGuard />
        {/* SoundManagerProvider is required for any descendant
            useSoundManager() call to actually produce audio. Without
            it, the hook returns the default context (no-op stubs)
            and every playSound call silently drops — which is why
            taps, bets, wins and the volume toggle all sounded broken
            on prod despite the underlying audio code being correct. */}
        <SoundManagerProvider>
          {children}
        </SoundManagerProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
