'use client';

import { useState, useCallback } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { SiweMessage } from 'siwe';
import { useQueryClient } from '@tanstack/react-query';
import { api, setJwt, getJwt } from '../lib/api';
import { queryKeys } from '../lib/query-keys';

const SIWE_DOMAIN = process.env.NEXT_PUBLIC_SIWE_DOMAIN || 'localhost';
const SIWE_ORIGIN = process.env.NEXT_PUBLIC_SIWE_ORIGIN || 'http://localhost:3000';

interface AuthState {
  isAuthenticated: boolean;
  jwt: string | null;
  userId: string | null;
}

export function useAuth() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const queryClient = useQueryClient();

  const [state, setState] = useState<AuthState>({
    isAuthenticated: !!getJwt(),
    jwt: getJwt(),
    userId: null,
  });
  const [isSigningIn, setIsSigningIn] = useState(false);

  const signIn = useCallback(async () => {
    if (!address || !isConnected) return;

    setIsSigningIn(true);
    try {
      // Step 1: Request nonce
      const { nonce } = await api.post<{ nonce: string }>('/auth/nonce', {
        wallet: address,
      });

      // Step 2: Construct SIWE message
      const message = new SiweMessage({
        domain: SIWE_DOMAIN,
        address,
        statement: 'Sign in to Rush',
        uri: SIWE_ORIGIN,
        version: '1',
        chainId: 8453, // Base
        nonce,
      });

      const messageStr = message.prepareMessage();

      // Step 3: Sign with wallet
      const signature = await signMessageAsync({ message: messageStr });

      // Step 4: Verify on backend
      const result = await api.post<{
        jwt: string;
        user: { id: string; wallet: string; isNew: boolean };
      }>('/auth/verify', { message: messageStr, signature });

      // Step 5: Store JWT
      setJwt(result.jwt);
      setState({
        isAuthenticated: true,
        jwt: result.jwt,
        userId: result.user.id,
      });

      // Invalidate profile cache
      queryClient.invalidateQueries({ queryKey: queryKeys.profile.me });
    } catch (err) {
      console.error('Sign in failed:', err);
      throw err;
    } finally {
      setIsSigningIn(false);
    }
  }, [address, isConnected, signMessageAsync, queryClient]);

  const signOut = useCallback(() => {
    setJwt(null);
    setState({ isAuthenticated: false, jwt: null, userId: null });
    queryClient.invalidateQueries({ queryKey: queryKeys.profile.me });
  }, [queryClient]);

  return {
    isAuthenticated: state.isAuthenticated,
    jwt: state.jwt,
    userId: state.userId,
    address,
    signIn,
    signOut,
    isSigningIn,
  };
}
