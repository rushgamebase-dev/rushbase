"use client";

import { useState, useEffect } from "react";

const DEXSCREENER_URL =
  "https://api.dexscreener.com/tokens/v1/base/0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b";

const REFETCH_MS = 30_000;

export function useRushPrice() {
  const [priceUsd, setPriceUsd] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchPrice() {
      try {
        const res = await window.fetch(DEXSCREENER_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const pairs: { priceUsd?: string }[] = json?.pairs ?? [];
        const raw = pairs[0]?.priceUsd;
        const parsed = raw ? parseFloat(raw) : null;
        if (!cancelled && parsed !== null && !isNaN(parsed)) {
          setPriceUsd(parsed);
        }
      } catch {
        // stale price stays
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchPrice();
    const id = setInterval(fetchPrice, REFETCH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return { priceUsd, loading };
}
