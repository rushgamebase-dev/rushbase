"use client";

import { ReactNode, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Cookies from "js-cookie";
import { useAuth, useBalance, useTrading, usePrices } from "@/stores";
import { useWebSocketTrading } from "@/hooks/use-websocket-trading";
import { Confetti } from "@/components/gamification/confetti";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      retry: 1,
    },
  },
});

function AuthInitializer({ children }: { children: ReactNode }) {
  const { setUser, isAuthenticated } = useAuth();
  const { fetchBalance } = useBalance();
  const { fetchActivePosition } = useTrading();
  const { fetchPrices } = usePrices();

  // Fetch prices on mount (always, even without auth)
  useEffect(() => {
    fetchPrices();
    // Refresh prices every 5 seconds as fallback
    const interval = setInterval(fetchPrices, 5000);
    return () => clearInterval(interval);
  }, [fetchPrices]);

  // Fetch balance and position when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      fetchBalance();
      fetchActivePosition();
    }
  }, [isAuthenticated, fetchBalance, fetchActivePosition]);

  return <>{children}</>;
}

function WebSocketInitializer({ children }: { children: ReactNode }) {
  // Initialize WebSocket connection
  useWebSocketTrading();
  return <>{children}</>;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthInitializer>
        <WebSocketInitializer>
          {children}
          <Confetti />
        </WebSocketInitializer>
      </AuthInitializer>
    </QueryClientProvider>
  );
}
