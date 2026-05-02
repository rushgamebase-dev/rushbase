"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useConnect } from "wagmi";
import { useTapTradeAuth } from "@/hooks/use-taptrade-auth";

/**
 * Wallet connect + SIWE landing for the TapTrade arena.
 *
 * Flow:
 *  1. User picks a connector (MetaMask / Coinbase / WalletConnect).
 *  2. Once `useAccount().isConnected`, the "Sign in with Ethereum"
 *     button appears.
 *  3. SIWE signature → engine /auth/siwe/{nonce,verify} →
 *     `taptrade_access_token` cookie set → redirect back to /trade.
 *
 * The TapTrade auth cookie is intentionally separate from any other
 * Rush auth (predict/tiles uses `profile-kit/useAuth` against a
 * different backend). A user can be signed into one and not the
 * other.
 */
export default function ConnectPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { connect, connectors, status } = useConnect();
  const { isAuthenticated, isSigningIn, signIn, error } = useTapTradeAuth();

  useEffect(() => {
    if (isAuthenticated) {
      router.replace("/trade");
    }
  }, [isAuthenticated, router]);

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 bg-black p-6 text-neon">
      <header className="text-center">
        <h1 className="font-mono text-3xl font-black tracking-widest">
          RUSH ARENA
        </h1>
        <p className="mt-2 font-mono text-xs uppercase tracking-[0.4em] text-neon/60">
          Provably-fair VRF arena
        </p>
      </header>

      {!isConnected && (
        <section className="w-full space-y-3">
          <p className="text-center font-mono text-sm text-neon/70">
            Connect a wallet to begin.
          </p>
          {connectors.map((c) => (
            <button
              key={c.uid}
              onClick={() => connect({ connector: c })}
              disabled={status === "pending"}
              className="w-full rounded-lg border-2 border-neon bg-neon/10 py-3 font-mono text-sm font-bold uppercase tracking-widest text-neon transition hover:bg-neon/20 disabled:opacity-50"
            >
              {c.name}
            </button>
          ))}
        </section>
      )}

      {isConnected && !isAuthenticated && (
        <section className="w-full space-y-3 text-center">
          <p className="font-mono text-xs text-neon/60">
            Connected as
          </p>
          <p className="break-all font-mono text-xs text-neon">{address}</p>
          <button
            onClick={() => void signIn()}
            disabled={isSigningIn}
            className="w-full rounded-lg border-2 border-neon bg-neon py-3 font-mono text-sm font-bold uppercase tracking-widest text-black transition hover:opacity-90 disabled:opacity-50"
          >
            {isSigningIn ? "Awaiting signature…" : "Sign in with Ethereum"}
          </button>
          <p className="font-mono text-[10px] text-neon/50">
            EIP-4361 message — no transaction, no gas. The engine
            verifies the signature and issues a JWT good for 15 min.
          </p>
        </section>
      )}

      {error && (
        <p className="break-all rounded-lg border border-red-400/40 bg-red-400/5 px-3 py-2 font-mono text-xs text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
