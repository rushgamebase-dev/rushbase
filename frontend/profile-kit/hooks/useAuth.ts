'use client';

import { useState, useCallback } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { SiweMessage } from 'siwe';
import { useQueryClient } from '@tanstack/react-query';
import { api, setJwt, getJwt } from '../lib/api';
import { queryKeys } from '../lib/query-keys';

// Env fallbacks used only if window isn't available (SSR). In the browser we
// always read the current location so SIWE domain/uri match wherever the page
// is actually served — prevents MetaMask "domain mismatch" warning when the
// site redirects between rushgame.vip / www.rushgame.vip / preview domains.
const SIWE_DOMAIN_FALLBACK = (process.env.NEXT_PUBLIC_SIWE_DOMAIN || 'localhost').trim();
const SIWE_ORIGIN_FALLBACK = (process.env.NEXT_PUBLIC_SIWE_ORIGIN || 'http://localhost:3000').trim();

interface AuthState { isAuthenticated: boolean; jwt: string | null; userId: string | null; }

export function useAuth() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ isAuthenticated: !!getJwt(), jwt: getJwt(), userId: null });
  const [isSigningIn, setIsSigningIn] = useState(false);

  const signIn = useCallback(async () => {
    if (!address || !isConnected) return;
    setIsSigningIn(true);
    try {
      const { nonce } = await api.post<{ nonce: string }>('/auth/nonce', { wallet: address });
      // Read live from window so we always match the page the user is actually on
      const domain = typeof window !== 'undefined' ? window.location.host : SIWE_DOMAIN_FALLBACK;
      const uri = typeof window !== 'undefined' ? window.location.origin : SIWE_ORIGIN_FALLBACK;
      const message = new SiweMessage({
        domain, address, statement: 'Sign in to Rush',
        uri, version: '1', chainId: 8453, nonce,
      });
      const messageStr = message.prepareMessage();
      const signature = await signMessageAsync({ message: messageStr });
      const result = await api.post<{ jwt: string; user: { id: string; wallet: string; isNew: boolean } }>(
        '/auth/verify', { message: messageStr, signature },
      );
      setJwt(result.jwt);
      setState({ isAuthenticated: true, jwt: result.jwt, userId: result.user.id });
      queryClient.invalidateQueries({ queryKey: queryKeys.profile.me });
    } catch (err) { console.error('Sign in failed:', err); throw err; }
    finally { setIsSigningIn(false); }
  }, [address, isConnected, signMessageAsync, queryClient]);

  const signOut = useCallback(() => {
    setJwt(null);
    setState({ isAuthenticated: false, jwt: null, userId: null });
    queryClient.invalidateQueries({ queryKey: queryKeys.profile.me });
  }, [queryClient]);

  return { isAuthenticated: state.isAuthenticated, jwt: state.jwt, userId: state.userId, address, signIn, signOut, isSigningIn };
}
