"use client";

/**
 * React hook around `lib/api/taptradeAuth`. Exposes the SIWE flow
 * (`signIn`), authenticated balance (`balance`), and the bearer
 * token presence (`isAuthenticated`). The hook subscribes to local
 * cookie state via a polling tick (250 ms) — cheap, and avoids
 * piping a global event bus through the providers tree just for
 * this surface.
 */

import { useCallback, useEffect, useState } from "react";
import { useAccount, useChainId, useSignMessage } from "wagmi";
import {
  clearAccessToken,
  fetchBalance,
  getAccessToken,
  signInWithEthereum,
  signOut as siweSignOut,
  type UserBalance,
} from "@/lib/api/taptradeAuth";

export interface TapTradeAuthState {
  isAuthenticated: boolean;
  isSigningIn: boolean;
  balance: UserBalance | null;
  freeBalanceWei: bigint;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshBalance: () => Promise<void>;
  error: string | null;
}

export function useTapTradeAuth(): TapTradeAuthState {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();

  const [token, setToken] = useState<string | null>(() => getAccessToken());
  const [balance, setBalance] = useState<UserBalance | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Poll the cookie cheaply so a sign-out from another tab (or the
  // engine clearing it on a 401) propagates here without React
  // context plumbing.
  useEffect(() => {
    const id = window.setInterval(() => {
      const next = getAccessToken();
      setToken((prev) => (prev === next ? prev : next));
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  const refreshBalance = useCallback(async () => {
    if (!getAccessToken()) {
      setBalance(null);
      return;
    }
    try {
      const b = await fetchBalance();
      setBalance(b);
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("Unauthorized")) {
        // Cookie was already cleared by `authedFetch`. Surface a
        // clean state to the UX.
        setBalance(null);
        setToken(null);
      }
      setError(msg);
    }
  }, []);

  // Refresh balance whenever the token flips on (or the page mounts
  // with a token already set).
  useEffect(() => {
    if (token) void refreshBalance();
    else setBalance(null);
  }, [token, refreshBalance]);

  // Wallet-change guard. The JWT identifies a single wallet; if the
  // user reconnects with a different account in MetaMask, we'd
  // otherwise keep showing the OLD wallet's balance (and they would
  // think their deposit disappeared). Detect the mismatch via the
  // `balance.wallet_address` snapshot the engine returns and force a
  // sign-out — the UI then prompts a fresh SIWE with the new wallet.
  useEffect(() => {
    if (!address || !balance?.wallet_address) return;
    if (balance.wallet_address.toLowerCase() !== address.toLowerCase()) {
      clearAccessToken();
      setToken(null);
      setBalance(null);
    }
  }, [address, balance]);

  // Disconnect guard: if wagmi loses the wallet entirely (user clicks
  // "Disconnect" in MetaMask), drop the token so the next sign-in
  // re-SIWEs with whatever wallet they connect next.
  useEffect(() => {
    if (!isConnected && token) {
      clearAccessToken();
      setToken(null);
      setBalance(null);
    }
  }, [isConnected, token]);

  const signIn = useCallback(async () => {
    if (!address || !isConnected) {
      setError("Connect a wallet first");
      return;
    }
    setIsSigningIn(true);
    setError(null);
    try {
      const auth = await signInWithEthereum({
        address,
        chainId,
        signMessage: ({ message }) => signMessageAsync({ message }),
      });
      setToken(auth.access_token);
      // The verify response carries a snapshot of the user but not
      // the full balance shape (no `total_balance_wei`); fetch the
      // canonical /user/balance to populate the store.
      await refreshBalance();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setIsSigningIn(false);
    }
  }, [address, isConnected, chainId, signMessageAsync, refreshBalance]);

  const signOut = useCallback(async () => {
    await siweSignOut();
    clearAccessToken();
    setToken(null);
    setBalance(null);
  }, []);

  const freeBalanceWei = balance ? safeBigInt(balance.free_balance_wei) : BigInt(0);

  return {
    isAuthenticated: !!token,
    isSigningIn,
    balance,
    freeBalanceWei,
    signIn,
    signOut,
    refreshBalance,
    error,
  };
}

function safeBigInt(s: string | undefined | null): bigint {
  if (!s) return BigInt(0);
  try {
    return BigInt(s);
  } catch {
    return BigInt(0);
  }
}
