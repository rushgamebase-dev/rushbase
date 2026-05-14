"use client";

/**
 * /stake — single-sided $RUSH staking with live ETH rewards.
 *
 * Design goal: maximum dopamine drip.
 *   - Big neon "EARNED" counter that ticks every animation frame
 *     (interpolates between 2-second on-chain polls so the number
 *     visibly moves at 60fps).
 *   - Mascot in the hero so the page has personality, not generic
 *     DeFi chrome.
 *   - One-click flow: approve → stake → see earnings climb → claim.
 *   - APR computed on-chain via the reward stream rate.
 *
 * No locks. No epochs. Stake/withdraw/claim independently at any
 * time. The Synthetix accumulator pattern in the contract makes this
 * O(1) per call and fair regardless of when the user joins or leaves.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useAccount,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
  useBalance,
} from "wagmi";
import { formatEther, parseEther, formatUnits, parseUnits } from "viem";
import { base } from "wagmi/chains";
import {
  RUSH_STAKING_ADDRESS,
  RUSH_TOKEN_ADDRESS,
  RUSH_STAKING_ABI,
  ERC20_MIN_ABI,
} from "@/lib/contracts/rushStaking";
import { WalletButton } from "@/components/WalletButton";
import Link from "next/link";
import DistributionsFeed from "@/components/stake/DistributionsFeed";

const STAKING = {
  address: RUSH_STAKING_ADDRESS,
  abi: RUSH_STAKING_ABI,
} as const;

const TOKEN = {
  address: RUSH_TOKEN_ADDRESS,
  abi: ERC20_MIN_ABI,
} as const;

type ActionMode = "stake" | "unstake";

export default function StakePage() {
  const { address, isConnected, chainId } = useAccount();
  const wrongChain = isConnected && chainId !== base.id;

  // ── On-chain reads (refetched every 4 s for global state, 2 s for
  //    user-specific state where the dopamine matters most). ───────
  const { data: pool, refetch: refetchPool } = useReadContracts({
    contracts: [
      { ...STAKING, functionName: "totalStaked" },
      { ...STAKING, functionName: "rewardRate" },
      { ...STAKING, functionName: "periodFinish" },
      { ...STAKING, functionName: "rewardsDuration" },
    ],
    query: { refetchInterval: 4_000 },
  });
  const totalStaked = (pool?.[0]?.result as bigint | undefined) ?? BigInt(0);
  const rewardRate = (pool?.[1]?.result as bigint | undefined) ?? BigInt(0);
  const periodFinish = (pool?.[2]?.result as bigint | undefined) ?? BigInt(0);
  const rewardsDuration = (pool?.[3]?.result as bigint | undefined) ?? BigInt(604800);

  const { data: user, refetch: refetchUser } = useReadContracts({
    contracts: address
      ? [
          { ...STAKING, functionName: "balances", args: [address] },
          { ...STAKING, functionName: "earned", args: [address] },
          { ...TOKEN, functionName: "balanceOf", args: [address] },
          {
            ...TOKEN,
            functionName: "allowance",
            args: [address, RUSH_STAKING_ADDRESS],
          },
        ]
      : [],
    query: { enabled: !!address, refetchInterval: 2_000 },
  });
  const userStake = (user?.[0]?.result as bigint | undefined) ?? BigInt(0);
  const earnedSnap = (user?.[1]?.result as bigint | undefined) ?? BigInt(0);
  const rushBalance = (user?.[2]?.result as bigint | undefined) ?? BigInt(0);
  const allowance = (user?.[3]?.result as bigint | undefined) ?? BigInt(0);

  const ethBal = useBalance({ address, query: { refetchInterval: 4_000 } });

  // ── Live earned interpolation: poll earned() every 2s, then
  //    requestAnimationFrame to smoothly tick the displayed value
  //    between snapshots. The contract's accumulator is exactly
  //    `userBalance × rewardRate / totalStaked × dt`, so we apply
  //    the same formula client-side between RPC calls. ──────────────
  const [liveEarned, setLiveEarned] = useState<bigint>(BigInt(0));
  const snapshotRef = useRef<{ value: bigint; takenAt: number }>({
    value: BigInt(0),
    takenAt: 0,
  });

  useEffect(() => {
    snapshotRef.current = {
      value: earnedSnap,
      takenAt: Date.now(),
    };
  }, [earnedSnap]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const snap = snapshotRef.current;
      const elapsedMs = Math.max(0, Date.now() - snap.takenAt);
      const periodFinishMs = Number(periodFinish) * 1000;
      const cappedAtFinish =
        periodFinishMs > 0 && Date.now() > periodFinishMs
          ? Math.max(0, periodFinishMs - snap.takenAt)
          : elapsedMs;
      // delta_eth = userStake * rewardRate * (elapsedMs / 1000) / totalStaked
      let delta = BigInt(0);
      if (totalStaked > BigInt(0) && userStake > BigInt(0) && rewardRate > BigInt(0)) {
        delta = (userStake * rewardRate * BigInt(cappedAtFinish)) / (totalStaked * BigInt(1000));
      }
      setLiveEarned(snap.value + delta);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [userStake, totalStaked, rewardRate, periodFinish]);

  // ── Inputs / actions ───────────────────────────────────────────
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<ActionMode>("stake");
  const parsed = useMemo(() => {
    if (!amount.trim()) return null;
    try {
      return parseUnits(amount, 18);
    } catch {
      return null;
    }
  }, [amount]);

  const needsApproval =
    mode === "stake" && parsed != null && parsed > BigInt(0) && allowance < parsed;

  const max = mode === "stake" ? rushBalance : userStake;
  const setMax = () => setAmount(formatUnits(max, 18));

  // ── Write hooks ────────────────────────────────────────────────
  const { writeContract, isPending: isWritePending, data: txHash, reset } = useWriteContract();
  const { isLoading: isMining, isSuccess: txSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // Refetch + clear input after each successful tx.
  useEffect(() => {
    if (txSuccess) {
      void refetchUser();
      setAmount("");
      reset();
    }
  }, [txSuccess, refetchUser, reset]);

  const onApprove = () => {
    if (!parsed) return;
    writeContract({
      address: TOKEN.address,
      abi: TOKEN.abi,
      functionName: "approve",
      args: [RUSH_STAKING_ADDRESS, parsed],
    });
  };
  const onStake = () => {
    if (!parsed) return;
    writeContract({
      address: STAKING.address,
      abi: STAKING.abi,
      functionName: "stake",
      args: [parsed],
    });
  };
  const onUnstake = () => {
    if (!parsed) return;
    writeContract({
      address: STAKING.address,
      abi: STAKING.abi,
      functionName: "withdraw",
      args: [parsed],
    });
  };
  const onClaim = () => {
    writeContract({
      address: STAKING.address,
      abi: STAKING.abi,
      functionName: "claim",
      args: [],
    });
  };

  // ── Derived metrics ────────────────────────────────────────────
  const sharePct =
    totalStaked > BigInt(0) ? Number((userStake * BigInt(10000)) / totalStaked) / 100 : 0;
  const periodFinishMs = Number(periodFinish) * 1000;
  const periodActive = periodFinishMs > Date.now();
  const periodLeftMs = Math.max(0, periodFinishMs - Date.now());
  const periodLeftStr = formatDuration(periodLeftMs);
  // ETH per year per RUSH wei (under current stream rate)
  const apr = useMemo(() => {
    if (!periodActive || totalStaked === BigInt(0) || rewardRate === BigInt(0)) return null;
    const ethPerYearWei = rewardRate * BigInt(31_536_000);
    // ETH per RUSH staked, per year — UI then lets user reason about
    // it in their own terms (knowing ETH and RUSH prices).
    const ethPerRushPerYear = Number(formatEther(ethPerYearWei)) / Number(formatEther(totalStaked));
    return ethPerRushPerYear;
  }, [rewardRate, totalStaked, periodActive]);

  return (
    <div className="min-h-screen bg-[#02070b] text-white">
      {/* Ambient background grid */}
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(#00ff66 1px, transparent 1px), linear-gradient(90deg, #00ff66 1px, transparent 1px)",
          backgroundSize: "44px 44px",
        }}
      />

      {/* Header */}
      <header className="relative flex items-center justify-between border-b border-[#10251d] bg-[#02070b]/95 px-4 py-3 backdrop-blur sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <span
            className="font-mono text-xl font-black tracking-[0.18em] text-[#00ff66]"
            style={{ textShadow: "0 0 12px rgba(0,255,102,0.55)" }}
          >
            RUSH
          </span>
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.32em] text-[#00ff66]/70">
            · staking
          </span>
        </Link>
        <WalletButton />
      </header>

      <main className="relative mx-auto flex w-full max-w-3xl flex-col items-center gap-6 px-4 py-8 sm:py-12">
        {/* Hero — mascot + earned counter */}
        <section className="flex w-full flex-col items-center gap-4">
          <div className="relative flex h-32 w-32 items-center justify-center sm:h-40 sm:w-40">
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background:
                  "radial-gradient(circle, rgba(0,255,102,0.25) 0%, rgba(0,255,102,0.08) 38%, transparent 70%)",
              }}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/taptrade/mascot.gif"
              alt="Rush mascot"
              className="relative h-full w-full object-contain drop-shadow-[0_8px_32px_rgba(0,0,0,0.6)]"
            />
          </div>

          <h1 className="font-mono text-3xl font-black tracking-[0.18em] text-white sm:text-4xl">
            stake <span className="text-[#00ff66]">$RUSH</span> · earn ETH
          </h1>

          {/* Big live counter — the dopamine engine */}
          <EarnedDisplay valueWei={liveEarned} />

          {address ? (
            <p className="font-mono text-[11px] text-[#7b9186]">
              every second your stake holds, the number above climbs
            </p>
          ) : (
            <p className="font-mono text-[11px] text-[#7b9186]">
              connect a wallet to start earning
            </p>
          )}
        </section>

        {/* Action card */}
        <section className="w-full rounded-2xl border border-[#10251d] bg-[#040b0f] p-4 shadow-[0_0_28px_rgba(0,255,102,0.06)] sm:p-5">
          {!isConnected ? (
            <div className="grid place-items-center py-10 text-center">
              <p className="font-mono text-sm text-[#8aa393]">
                connect a wallet to stake
              </p>
            </div>
          ) : wrongChain ? (
            <div className="grid place-items-center py-10 text-center">
              <p className="font-mono text-sm font-bold text-[#ff7d65]">
                switch network to Base mainnet
              </p>
            </div>
          ) : (
            <>
              {/* Mode toggle */}
              <div className="mb-3 grid grid-cols-2 gap-2 rounded-lg border border-[#10251d] bg-[#02070b] p-1">
                <button
                  onClick={() => setMode("stake")}
                  className={`h-10 rounded-md font-mono text-xs font-black uppercase tracking-[0.22em] transition ${
                    mode === "stake"
                      ? "bg-[#00ff66]/12 text-[#00ff66] shadow-[0_0_12px_rgba(0,255,102,0.18)]"
                      : "text-[#5a8068] hover:text-white"
                  }`}
                >
                  stake
                </button>
                <button
                  onClick={() => setMode("unstake")}
                  className={`h-10 rounded-md font-mono text-xs font-black uppercase tracking-[0.22em] transition ${
                    mode === "unstake"
                      ? "bg-[#ffb400]/12 text-[#ffb400]"
                      : "text-[#5a8068] hover:text-white"
                  }`}
                >
                  unstake
                </button>
              </div>

              {/* Amount input */}
              <label className="flex items-center gap-3 rounded-lg border border-[#1d3327] bg-[#02070b] px-4 py-3">
                <input
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v !== "" && !/^\d*\.?\d*$/.test(v)) return;
                    setAmount(v);
                  }}
                  placeholder="0.0"
                  className="min-w-0 flex-1 bg-transparent font-mono text-2xl font-black text-white outline-none placeholder:text-[#3a5247]"
                />
                <span className="font-mono text-xs font-bold text-[#8aa393]">
                  $RUSH
                </span>
                <button
                  onClick={setMax}
                  className="rounded-md border border-[#1d3327] bg-[#040b0f] px-2.5 py-1 font-mono text-[10px] font-black uppercase tracking-widest text-[#00ff66] transition hover:border-[#00ff66]/60"
                >
                  max
                </button>
              </label>

              <p className="mt-2 font-mono text-[11px] text-[#5a8068]">
                {mode === "stake"
                  ? `wallet · ${fmtRush(rushBalance)} $RUSH`
                  : `staked · ${fmtRush(userStake)} $RUSH`}
              </p>

              {/* CTA */}
              <div className="mt-4 grid gap-2">
                {mode === "stake" ? (
                  needsApproval ? (
                    <ActionButton
                      label="approve $RUSH"
                      onClick={onApprove}
                      disabled={isWritePending || isMining}
                      loading={isWritePending || isMining}
                      tone="approve"
                    />
                  ) : (
                    <ActionButton
                      label="stake"
                      onClick={onStake}
                      disabled={!parsed || parsed === BigInt(0) || parsed > rushBalance || isWritePending || isMining}
                      loading={isWritePending || isMining}
                      tone="primary"
                    />
                  )
                ) : (
                  <ActionButton
                    label="unstake"
                    onClick={onUnstake}
                    disabled={!parsed || parsed === BigInt(0) || parsed > userStake || isWritePending || isMining}
                    loading={isWritePending || isMining}
                    tone="warn"
                  />
                )}

                <ActionButton
                  label={`claim ${fmtEth(liveEarned)} ETH`}
                  onClick={onClaim}
                  disabled={liveEarned === BigInt(0) || isWritePending || isMining}
                  loading={isWritePending || isMining}
                  tone="claim"
                />
              </div>
            </>
          )}
        </section>

        {/* Stats grid */}
        <section className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="your stake" value={fmtRush(userStake, 2)} unit="$RUSH" tone="green" />
          <Stat label="your share" value={`${sharePct.toFixed(2)}`} unit="%" />
          <Stat label="pool tvl" value={fmtRush(totalStaked, 2)} unit="$RUSH" />
          <Stat
            label={periodActive ? "stream ends in" : "stream"}
            value={periodActive ? periodLeftStr : "ended"}
            unit=""
            tone={periodActive ? "green" : "warn"}
          />
        </section>

        {/* Period detail */}
        <section className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-[#10251d] bg-[#040b0f] p-3">
            <div className="font-mono text-[10px] font-black uppercase tracking-[0.22em] text-[#5a8068]">
              reward rate
            </div>
            <div className="mt-1 font-mono text-base font-black text-white">
              {fmtEth(rewardRate * BigInt(86400), 6)} <span className="text-xs text-[#8aa393]">ETH/day</span>
            </div>
            <div className="mt-1 font-mono text-[10px] text-[#5a8068]">
              streamed continuously over {Number(rewardsDuration) / 86400} days
            </div>
          </div>
          <div className="rounded-xl border border-[#10251d] bg-[#040b0f] p-3">
            <div className="font-mono text-[10px] font-black uppercase tracking-[0.22em] text-[#5a8068]">
              eth wallet
            </div>
            <div className="mt-1 font-mono text-base font-black text-white">
              {ethBal.data ? fmtEth(ethBal.data.value, 4) : "—"} <span className="text-xs text-[#8aa393]">ETH</span>
            </div>
            <div className="mt-1 font-mono text-[10px] text-[#5a8068]">
              your wallet balance on Base
            </div>
          </div>
        </section>

        {/* APR badge */}
        {apr !== null && (
          <div className="rounded-full border border-[#1aff84]/35 bg-[#06361b]/40 px-4 py-1.5 font-mono text-[11px] font-black uppercase tracking-[0.22em] text-[#00ff66]">
            {(apr * 100).toFixed(3)} ETH per RUSH per year (current rate)
          </div>
        )}

        {/* Distributions feed — recent RewardAdded events with live splash */}
        <DistributionsFeed
          onRewardAdded={() => {
            void refetchPool();
            void refetchUser();
          }}
        />

        {/* Trust strip */}
        <section className="grid w-full grid-cols-1 gap-2 sm:grid-cols-3">
          <Trust label="100% on-chain" body="Synthetix accumulator pattern. No epochs, no snapshots, no admin claims." />
          <Trust label="real ETH" body="Rewards come from TapTrading house edge, paid in ETH on Base." />
          <Trust label="no locks" body="Stake, unstake, claim — independently, any time. Zero penalties." />
        </section>

        {/* Status */}
        {txHash && (
          <a
            href={`https://basescan.org/tx/${txHash}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-[#1aff84]/35 bg-[#06361b]/40 px-4 py-1.5 font-mono text-[10px] font-bold text-[#00ff66] hover:bg-[#06361b]/70"
          >
            {isMining ? "tx mining" : txSuccess ? "tx confirmed" : "tx submitted"} · {short(txHash)} ↗
          </a>
        )}

        <footer className="mt-2 text-center font-mono text-[10px] uppercase tracking-[0.22em] text-[#5a8068]">
          contract · {short(RUSH_STAKING_ADDRESS, 10, 6)} · base mainnet
        </footer>
      </main>
    </div>
  );
}

// ── Components ───────────────────────────────────────────────────

function EarnedDisplay({ valueWei }: { valueWei: bigint }) {
  const formatted = formatEther(valueWei);
  // Split into integer + decimal so we can style the decimals smaller
  const [intPart, decPart] = formatted.split(".");
  const decimals = (decPart || "").padEnd(8, "0").slice(0, 8);

  return (
    <div className="flex w-full flex-col items-center">
      <div className="font-mono text-[10px] font-black uppercase tracking-[0.32em] text-[#00ff66]/80">
        earned · live
      </div>
      <div
        className="mt-1 flex items-baseline gap-1 font-sans text-[44px] font-black leading-none text-[#00ff66] sm:text-[64px]"
        style={{
          textShadow: "0 0 24px rgba(0,255,102,0.55), 0 0 6px rgba(0,255,102,0.85)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span>{intPart || "0"}</span>
        <span className="text-[24px] text-[#00ff66]/80 sm:text-[36px]">
          .{decimals}
        </span>
        <span className="ml-2 self-end pb-1 font-mono text-sm font-bold text-[#9ec3aa] sm:text-base">
          ETH
        </span>
      </div>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
  loading,
  tone = "primary",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  tone?: "primary" | "claim" | "approve" | "warn";
}) {
  const palette = {
    primary: "bg-gradient-to-b from-[#00ff66] to-[#00cc55] text-[#02260f] shadow-[0_0_28px_rgba(0,255,102,0.42)] hover:shadow-[0_0_42px_rgba(0,255,102,0.6)]",
    claim: "bg-gradient-to-b from-[#1aff84] to-[#00cc55] text-[#02260f] shadow-[0_0_28px_rgba(26,255,132,0.42)] hover:shadow-[0_0_42px_rgba(26,255,132,0.6)]",
    approve: "bg-gradient-to-b from-[#ffb400] to-[#cc8c00] text-[#1f1300] shadow-[0_0_28px_rgba(255,180,0,0.32)]",
    warn: "bg-[#1a0d0a] border-2 border-[#ff7d65] text-[#ff7d65] hover:bg-[#1a0d0a]/80",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex h-14 w-full items-center justify-center rounded-xl font-mono text-sm font-black uppercase tracking-[0.28em] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${palette[tone]}`}
    >
      {loading ? "…" : label}
    </button>
  );
}

function Stat({
  label,
  value,
  unit,
  tone = "default",
}: {
  label: string;
  value: string;
  unit: string;
  tone?: "default" | "green" | "warn";
}) {
  const color =
    tone === "green" ? "text-[#00ff66]" : tone === "warn" ? "text-[#ff7d65]" : "text-white";
  return (
    <div className="rounded-xl border border-[#10251d] bg-[#040b0f] p-3">
      <div className="font-mono text-[9px] font-black uppercase tracking-[0.32em] text-[#5a8068]">
        {label}
      </div>
      <div className={`mt-1 font-mono text-base font-black ${color}`}>
        {value} <span className="text-[10px] text-[#8aa393]">{unit}</span>
      </div>
    </div>
  );
}

function Trust({ label, body }: { label: string; body: string }) {
  return (
    <div className="rounded-xl border border-[#10251d] bg-[#02070b] p-3">
      <div className="font-mono text-[9px] font-black uppercase tracking-[0.32em] text-[#00ff66]/80">
        {label}
      </div>
      <p className="mt-1 font-mono text-[11px] leading-relaxed text-[#7b9186]">
        {body}
      </p>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function fmtRush(wei: bigint, decimals = 4): string {
  const eth = Number(formatUnits(wei, 18));
  if (eth === 0) return "0";
  if (eth < 0.0001) return eth.toExponential(2);
  if (eth < 1) return eth.toFixed(decimals);
  if (eth < 1000) return eth.toFixed(2);
  return eth.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function fmtEth(wei: bigint, decimals = 6): string {
  const eth = Number(formatEther(wei));
  if (eth === 0) return "0";
  if (eth < 0.000001) return "0";
  return eth.toLocaleString("en-US", {
    minimumFractionDigits: Math.min(decimals, 6),
    maximumFractionDigits: decimals,
  });
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "ended";
  const sec = Math.floor(ms / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function short(addr: string, head = 6, tail = 4): string {
  if (!addr || addr.length < head + tail + 2) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

// `parseEther` is imported but unused — keep the import so future
// helpers can switch fmtRush precision without touching imports.
void parseEther;
