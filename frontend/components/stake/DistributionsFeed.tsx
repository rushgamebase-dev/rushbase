"use client";

/**
 * DistributionsFeed — recent RewardAdded events from the staking contract,
 * with a green splash overlay + sound when a new one arrives while the
 * /stake page is open.
 *
 * - Backfills the last 5 RewardAdded events at mount (one-shot eth_getLogs).
 * - Subscribes to new events via wagmi's useWatchContractEvent. Each new
 *   event prepends to the list, fires the splash, and rings the SoundManager.
 * - Splash auto-dismisses in 4s; user can click to dismiss earlier.
 */

import { useCallback, useEffect, useState } from "react";
import { usePublicClient, useWatchContractEvent } from "wagmi";
import { base } from "wagmi/chains";
import { formatEther } from "viem";
import {
  RUSH_STAKING_ABI,
  RUSH_STAKING_ADDRESS,
} from "@/lib/contracts/rushStaking";
import { useSoundManager } from "@/components/gamification/sound-manager";

type Distribution = {
  txHash: string;
  blockNumber: bigint;
  ethAmount: bigint;
  newRewardRate: bigint;
  periodFinish: bigint;
  timestamp: number; // unix seconds, 0 if unknown until block fetched
};

const BACKFILL_BLOCK_RANGE = BigInt(50_000); // ~28h at 2s blocks on Base
const MAX_ITEMS = 5;

export default function DistributionsFeed({
  onRewardAdded,
}: {
  /** Callback fired when a NEW (live) reward arrives — used by the page
   * to trigger refetchAll on the staking stats. Splash + sound are handled
   * inside this component so the page stays clean. */
  onRewardAdded?: (ethAmount: bigint) => void;
}) {
  const client = usePublicClient({ chainId: base.id });
  const [items, setItems] = useState<Distribution[]>([]);
  const [splash, setSplash] = useState<Distribution | null>(null);
  const sound = useSoundManager();

  // ── Backfill last few RewardAdded events ─────────────────────────────────
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    (async () => {
      try {
        const head = await client.getBlockNumber();
        const fromBlock =
          head > BACKFILL_BLOCK_RANGE ? head - BACKFILL_BLOCK_RANGE : BigInt(0);
        const logs = await client.getContractEvents({
          address: RUSH_STAKING_ADDRESS,
          abi: RUSH_STAKING_ABI,
          eventName: "RewardAdded",
          fromBlock,
          toBlock: head,
        });
        // Most recent first, capped to MAX_ITEMS.
        const recent = logs.slice(-MAX_ITEMS).reverse();
        const enriched: Distribution[] = await Promise.all(
          recent.map(async (l) => {
            let ts = 0;
            try {
              const block = await client.getBlock({ blockNumber: l.blockNumber });
              ts = Number(block.timestamp);
            } catch {
              // Best-effort; leave 0 if RPC errors.
            }
            const args = l.args as {
              ethAmount?: bigint;
              newRewardRate?: bigint;
              periodFinish?: bigint;
            };
            return {
              txHash: l.transactionHash,
              blockNumber: l.blockNumber,
              ethAmount: args.ethAmount ?? BigInt(0),
              newRewardRate: args.newRewardRate ?? BigInt(0),
              periodFinish: args.periodFinish ?? BigInt(0),
              timestamp: ts,
            };
          }),
        );
        if (!cancelled) setItems(enriched);
      } catch (e) {
        // Silent — feed degrades gracefully if RPC is unreachable.
        console.warn("DistributionsFeed backfill failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  // ── Live subscribe ──────────────────────────────────────────────────────
  useWatchContractEvent({
    address: RUSH_STAKING_ADDRESS,
    abi: RUSH_STAKING_ABI,
    eventName: "RewardAdded",
    chainId: base.id,
    onLogs: (logs) => {
      if (!logs.length) return;
      // Process most recent first.
      const newest = logs[logs.length - 1];
      const args = newest.args as {
        ethAmount?: bigint;
        newRewardRate?: bigint;
        periodFinish?: bigint;
      };
      const dist: Distribution = {
        txHash: newest.transactionHash ?? "",
        blockNumber: newest.blockNumber ?? BigInt(0),
        ethAmount: args.ethAmount ?? BigInt(0),
        newRewardRate: args.newRewardRate ?? BigInt(0),
        periodFinish: args.periodFinish ?? BigInt(0),
        timestamp: Math.floor(Date.now() / 1000),
      };
      setItems((prev) => {
        // Dedup by txHash so a duplicate WS replay doesn't double-prepend.
        if (prev.some((p) => p.txHash === dist.txHash)) return prev;
        return [dist, ...prev].slice(0, MAX_ITEMS);
      });
      setSplash(dist);
      sound.playSound("win");
      onRewardAdded?.(dist.ethAmount);
    },
  });

  // Splash auto-dismiss
  useEffect(() => {
    if (!splash) return;
    const t = setTimeout(() => setSplash(null), 4000);
    return () => clearTimeout(t);
  }, [splash]);

  const dismissSplash = useCallback(() => setSplash(null), []);

  return (
    <>
      <section className="w-full rounded-xl border border-[#10251d] bg-[#040b0f] p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="font-mono text-[10px] font-black uppercase tracking-[0.22em] text-[#5a8068]">
            recent distributions
          </div>
          <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#3d5a4a]">
            live · auto-update
          </div>
        </div>

        {items.length === 0 ? (
          <div className="py-3 text-center font-mono text-xs text-[#5a8068]">
            no distributions in the last ~28h — pool seeding only.
            <br />
            new drops post here automatically.
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {items.map((d) => (
              <li
                key={d.txHash}
                className="flex items-center justify-between rounded-lg border border-[#0d1f17] bg-[#020708] px-2.5 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#1aff84]" />
                  <span className="font-mono text-[11px] text-[#8aa393]">
                    {ago(d.timestamp)}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs font-black text-[#1aff84] tabular-nums">
                    +{formatEth(d.ethAmount)} ETH
                  </span>
                  {d.txHash ? (
                    <a
                      href={`https://basescan.org/tx/${d.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#5a8068] hover:text-[#1aff84]"
                    >
                      tx ↗
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Splash overlay — green flash + center stat — fired on new event. */}
      {splash && (
        <button
          type="button"
          aria-label="Dismiss reward notification"
          onClick={dismissSplash}
          className="fixed inset-0 z-[60] flex items-center justify-center"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(26,255,132,0.18) 0%, rgba(0,0,0,0.55) 60%, rgba(0,0,0,0.85) 100%)",
            backdropFilter: "blur(2px)",
            animation: "rushFlashIn 220ms ease-out",
          }}
        >
          <div
            className="rounded-2xl border border-[#1aff84]/60 bg-[#04140b] px-8 py-7 text-center shadow-[0_0_60px_rgba(26,255,132,0.45)]"
            style={{ animation: "rushPopIn 320ms cubic-bezier(.2,.7,.2,1.4)" }}
          >
            <div className="mb-1 font-mono text-[10px] font-black uppercase tracking-[0.32em] text-[#1aff84]">
              new distribution
            </div>
            <div className="font-mono text-4xl font-black text-white tabular-nums">
              +{formatEth(splash.ethAmount)}
              <span className="ml-2 text-base text-[#8aa393]">ETH</span>
            </div>
            <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[#5a8068]">
              flowing into the pool — your earned counter just kicked
            </div>
          </div>
          {/* Inline keyframes so the component is self-contained. */}
          <style>{`
            @keyframes rushFlashIn {
              from { opacity: 0; }
              to   { opacity: 1; }
            }
            @keyframes rushPopIn {
              from { transform: scale(0.7); opacity: 0; }
              to   { transform: scale(1);   opacity: 1; }
            }
          `}</style>
        </button>
      )}
    </>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

function formatEth(wei: bigint, decimals = 4): string {
  // formatEther returns string like "0.0123456" — truncate.
  const s = formatEther(wei);
  const [whole, frac = ""] = s.split(".");
  if (!frac) return whole;
  return `${whole}.${frac.slice(0, decimals)}`;
}

function ago(unix: number): string {
  if (!unix) return "—";
  const dt = Date.now() / 1000 - unix;
  if (dt < 60) return `${Math.floor(dt)}s ago`;
  if (dt < 3600) return `${Math.floor(dt / 60)}m ago`;
  if (dt < 86400) return `${Math.floor(dt / 3600)}h ago`;
  return `${Math.floor(dt / 86400)}d ago`;
}
