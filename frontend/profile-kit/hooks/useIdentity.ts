'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '../lib/api';
import type { MiniProfile } from '../types/profile';

// ─────────────────────────────────────────────────────────────────
// Batching collector
// ─────────────────────────────────────────────────────────────────
// Every useIdentity() call registers its address. We debounce 0ms,
// group every pending address from the current React commit into
// ONE request to /users/batch, then fan out results.
// Result: a page with 30 IdentityChips = 1 backend request.
// ─────────────────────────────────────────────────────────────────

const pendingAddrs = new Set<string>();
const pendingResolvers = new Map<string, Array<(v: MiniProfile | null) => void>>();
let flushScheduled = false;

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(flush, 0);
}

async function flush() {
  flushScheduled = false;
  if (pendingAddrs.size === 0) return;

  const batch = Array.from(pendingAddrs);
  pendingAddrs.clear();

  // Backend caps at 50 per request. Chunk if bigger.
  const chunks: string[][] = [];
  for (let i = 0; i < batch.length; i += 50) {
    chunks.push(batch.slice(i, i + 50));
  }

  const results: Record<string, MiniProfile> = {};

  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const res = await api.get<Record<string, MiniProfile>>(
          `/users/batch?addresses=${chunk.map(encodeURIComponent).join(',')}`,
        );
        Object.assign(results, res);
      } catch {
        // Individual resolvers will see null below
      }
    }),
  );

  for (const addr of batch) {
    const resolvers = pendingResolvers.get(addr) ?? [];
    pendingResolvers.delete(addr);
    const key = addr.toLowerCase();
    for (const r of resolvers) r(results[key] ?? null);
  }
}

function queueIdentity(address: string): Promise<MiniProfile | null> {
  const addr = address.toLowerCase();
  return new Promise((resolve) => {
    pendingAddrs.add(addr);
    const list = pendingResolvers.get(addr) ?? [];
    list.push(resolve);
    pendingResolvers.set(addr, list);
    scheduleFlush();
  });
}

// ─────────────────────────────────────────────────────────────────
// Public hook — usable anywhere an address is shown
// ─────────────────────────────────────────────────────────────────

export function useIdentity(address: string | null | undefined) {
  return useQuery({
    queryKey: ['identity', address?.toLowerCase() ?? 'none'],
    queryFn: () => queueIdentity(address!),
    enabled: !!address,
    staleTime: 5 * 60_000,
  });
}

// Optionally prefetch many at once (e.g. from /transparency leaderboard)
export function usePrefetchIdentities(addresses: string[]) {
  const client = useQueryClient();
  useEffect(() => {
    for (const addr of addresses) {
      const key = ['identity', addr.toLowerCase()];
      if (client.getQueryState(key)?.data !== undefined) continue;
      client.prefetchQuery({
        queryKey: key,
        queryFn: () => queueIdentity(addr),
        staleTime: 5 * 60_000,
      });
    }
  }, [addresses.join(','), client]);
}
