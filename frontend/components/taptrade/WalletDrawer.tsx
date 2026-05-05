"use client";

/**
 * WalletDrawer — slide-in panel for funding and exiting the
 * TapTrading vault. Sits on top of the arena, never replaces it.
 *
 * Two flows:
 *   - Deposit: user → TradingVault.deposit() (payable). Engine
 *     listens for `Deposited` and credits the off-chain ledger
 *     after `min_confirmations`.
 *   - Withdraw: engine signs an EIP-191 authorization (validates
 *     free balance + on-chain liquidity), user submits
 *     TradingVault.withdraw() with their wallet.
 *
 * Visual is strictly the Rush Arena palette (#020403 / #00ff66 /
 * #8aa393 / mono uppercase) — no rounded balloons, no light theme,
 * no rogue colors. Tabs and inputs mirror the trade sidebar.
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, ExternalLink, X } from "lucide-react";
import { formatEther, parseEther } from "viem";
import { useAccount, useBalance, useChainId } from "wagmi";
import { base } from "wagmi/chains";

import { useVaultDeposit } from "@/hooks/useVaultDeposit";
import { useVaultWithdraw } from "@/hooks/useVaultWithdraw";
import { useTapTradeAuth } from "@/hooks/use-taptrade-auth";
import {
  TRADING_VAULT_ADDRESS,
  isVaultConfigured,
} from "@/lib/contracts/tradingVault";

const PALETTE = {
  bg: "#020403",
  panel: "#02070b",
  panelDeep: "#020806",
  border: "#10251d",
  borderActive: "#1d3327",
  accent: "#00ff66",
  accentDim: "#1aff84",
  text: "#dfffe6",
  muted: "#8aa393",
  mutedDeep: "#5a8068",
  danger: "#ff3b4d",
  warn: "#ff9a3b",
};

const DEPOSIT_PRESETS_ETH = ["0.001", "0.005", "0.01", "0.05"] as const;
const WITHDRAW_PRESETS_PCT = [0.25, 0.5, 0.75, 1] as const;

const BLOCK_EXPLORER_TX = "https://basescan.org/tx";
const BLOCK_EXPLORER_ADDRESS = "https://basescan.org/address";

interface WalletDrawerProps {
  open: boolean;
  onClose: () => void;
}

type Tab = "deposit" | "withdraw";

export function WalletDrawer({ open, onClose }: WalletDrawerProps) {
  const [tab, setTab] = useState<Tab>("deposit");

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close wallet"
        onClick={onClose}
        className="absolute inset-0 bg-black/65 backdrop-blur-sm transition-opacity"
      />
      <aside
        role="dialog"
        aria-label="Wallet"
        className="relative flex h-full w-full max-w-[420px] flex-col border-l border-[#10251d] bg-[#02070b] shadow-[-12px_0_48px_rgba(0,0,0,0.6)]"
      >
        <DrawerHeader onClose={onClose} />
        <div className="flex flex-col gap-4 overflow-y-auto px-5 pb-6 pt-1">
          <BalanceSummary />
          <TabSwitch tab={tab} setTab={setTab} />
          {tab === "deposit" ? <DepositPane /> : <WithdrawPane />}
          <VaultFooter />
        </div>
      </aside>
    </div>
  );
}

// ── Header ─────────────────────────────────────────────────────────

function DrawerHeader({ onClose }: { onClose: () => void }) {
  const { address } = useAccount();
  return (
    <header className="flex items-center justify-between border-b border-[#10251d] px-5 py-4">
      <div>
        <div className="font-mono text-[10px] font-black uppercase tracking-[0.32em] text-[#5a8068]">
          Wallet
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="font-sans text-2xl font-black text-white">
            Vault
          </span>
          <span className="rounded border border-[#1aff84]/35 bg-[#06361b]/60 px-1.5 py-0.5 font-mono text-[10px] font-black uppercase tracking-widest text-[#00ff66]">
            Base
          </span>
        </div>
        {address && (
          <a
            href={`${BLOCK_EXPLORER_ADDRESS}/${address}`}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 font-mono text-[11px] text-[#8aa393] hover:text-[#00ff66]"
          >
            {shortAddress(address)} <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close wallet"
        className="grid h-9 w-9 place-items-center rounded-md border border-[#1d3327] bg-[#040b0f] text-[#b8c7d9] transition hover:border-[#00ff66]/60 hover:text-[#00ff66]"
      >
        <X className="h-4 w-4" />
      </button>
    </header>
  );
}

// ── Balance summary ────────────────────────────────────────────────

function BalanceSummary() {
  const { balance } = useTapTradeAuth();
  const { address } = useAccount();
  const wallet = useBalance({ address });

  const free = balance ? safeEth(balance.free_balance_wei) : "0";
  const locked = balance ? safeEth(balance.locked_margin_wei) : "0";
  const walletEth = wallet.data ? truncEth(formatEther(wallet.data.value)) : "—";

  return (
    <section className="rounded-lg border border-[#10251d] bg-[#020806] p-4 shadow-[0_0_28px_rgba(0,255,102,0.04)]">
      <div className="font-mono text-[10px] font-black uppercase tracking-[0.28em] text-[#5a8068]">
        Free balance
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span
          className="font-sans text-3xl font-black text-white"
          style={{ textShadow: "0 0 18px rgba(0,255,102,0.2)" }}
        >
          {free}
        </span>
        <span className="font-mono text-xs font-bold text-[#8aa393]">ETH</span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[#10251d] pt-3 font-mono">
        <Stat label="Locked" value={locked} unit="ETH" />
        <Stat label="In wallet" value={walletEth} unit="ETH" tone="muted" />
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  unit,
  tone = "muted",
}: {
  label: string;
  value: string;
  unit: string;
  tone?: "muted" | "accent" | "danger";
}) {
  const color =
    tone === "accent"
      ? "text-[#00ff66]"
      : tone === "danger"
      ? "text-[#ff3b4d]"
      : "text-[#dfffe6]";
  return (
    <div>
      <div className="text-[9px] font-black uppercase tracking-widest text-[#5a8068]">
        {label}
      </div>
      <div className={`mt-1 truncate text-sm font-black ${color}`}>
        {value}
        <span className="ml-1 text-[10px] font-bold text-[#5a8068]">{unit}</span>
      </div>
    </div>
  );
}

// ── Tabs ───────────────────────────────────────────────────────────

function TabSwitch({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 rounded-lg border border-[#10251d] bg-[#020806] p-1">
      <TabButton
        active={tab === "deposit"}
        onClick={() => setTab("deposit")}
        icon={<ArrowDownToLine className="h-3.5 w-3.5" />}
        label="Deposit"
      />
      <TabButton
        active={tab === "withdraw"}
        onClick={() => setTab("withdraw")}
        icon={<ArrowUpFromLine className="h-3.5 w-3.5" />}
        label="Withdraw"
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-10 items-center justify-center gap-2 rounded-md font-mono text-xs font-black uppercase tracking-widest transition ${
        active
          ? "bg-[#00ff66] text-[#02260f] shadow-[0_0_18px_rgba(0,255,102,0.32)]"
          : "text-[#8aa393] hover:text-white"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ── Deposit pane ───────────────────────────────────────────────────

function DepositPane() {
  const [amount, setAmount] = useState("0.005");
  const { isAuthenticated, refreshBalance } = useTapTradeAuth();
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { deposit, isSubmitting, isMining, isSuccess, error, hash, reset } =
    useVaultDeposit();

  // Refresh off-chain balance once the on-chain confirmation lands.
  // The engine listener typically catches the event within
  // (2 confirmations × ~2 s/block) + (poll-tick ≤5 s) = ~10 s end-to-end.
  // Polling once after a fixed delay is fragile — too early and the
  // refresh hits the engine before it credited; too late and the user
  // stares at a stale number. Retry every 1 s for up to 20 s, but
  // stop as soon as a refresh actually returns. The background 1 s
  // poll on the trade page will keep the number live afterward.
  useEffect(() => {
    if (!isSuccess) return;
    let cancelled = false;
    const startedAt = Date.now();
    const tick = async () => {
      if (cancelled) return;
      try {
        await refreshBalance();
      } catch {
        // Swallow — retry covers transient errors.
      }
    };
    void tick();
    const id = window.setInterval(() => {
      if (cancelled || Date.now() - startedAt > 20_000) {
        window.clearInterval(id);
        return;
      }
      void tick();
    }, 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [isSuccess, refreshBalance]);

  const wrongChain = isConnected && chainId !== base.id;
  const ready =
    isAuthenticated && isConnected && !wrongChain && isVaultConfigured();
  const parsed = safeParseEth(amount);
  const valid = parsed !== null && parsed >= parseEther("0.001");
  const canSubmit = ready && valid && !isSubmitting && !isMining;

  return (
    <section className="flex flex-col gap-3">
      <AmountInput
        label="Amount"
        value={amount}
        onChange={setAmount}
        unit="ETH"
        disabled={isSubmitting || isMining}
      />
      <div className="grid grid-cols-4 gap-2">
        {DEPOSIT_PRESETS_ETH.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setAmount(p)}
            className={`h-9 rounded-md border font-mono text-xs font-black uppercase tracking-widest transition ${
              amount === p
                ? "border-[#00ff66]/80 bg-[#00ff66]/10 text-white"
                : "border-[#1d3327] bg-[#040b0f] text-[#8aa393] hover:border-[#00ff66]/50 hover:text-[#00ff66]"
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      <Guidance
        connected={isConnected}
        authed={isAuthenticated}
        wrongChain={wrongChain}
        configured={isVaultConfigured()}
        valid={valid}
        amount={amount}
      />

      <button
        type="button"
        disabled={!canSubmit}
        onClick={() => void deposit(amount)}
        className={`flex h-12 items-center justify-center rounded-lg font-mono text-sm font-black uppercase tracking-widest transition ${
          canSubmit
            ? "bg-[#00ff66] text-[#02260f] shadow-[0_0_24px_rgba(0,255,102,0.32)] hover:brightness-110"
            : "cursor-not-allowed bg-[#0a1612] text-[#3f5a4d]"
        }`}
      >
        {isSubmitting
          ? "Confirm in wallet…"
          : isMining
          ? "Mining…"
          : isSuccess
          ? "Deposited ✓"
          : "Deposit ETH"}
      </button>

      <FlowResult hash={hash} error={error} success={isSuccess} reset={reset} />
    </section>
  );
}

// ── Withdraw pane ──────────────────────────────────────────────────

function WithdrawPane() {
  const { isAuthenticated, balance, refreshBalance } = useTapTradeAuth();
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const free = balance ? safeBig(balance.free_balance_wei) : BigInt(0);
  const freeEth = formatEther(free);

  const [amount, setAmount] = useState("");
  const { withdraw, step, hash, error, reset } = useVaultWithdraw();

  // Same aggressive retry pattern as DepositPane: the on-chain
  // Withdrawn event takes a few seconds to reach the listener, so a
  // single timed refresh races the engine and lands on stale data.
  // Poll every 1 s for 20 s instead.
  useEffect(() => {
    if (step !== "done") return;
    let cancelled = false;
    const startedAt = Date.now();
    const tick = async () => {
      if (cancelled) return;
      try {
        await refreshBalance();
      } catch {
        // ignore; retry covers transient.
      }
    };
    void tick();
    const id = window.setInterval(() => {
      if (cancelled || Date.now() - startedAt > 20_000) {
        window.clearInterval(id);
        return;
      }
      void tick();
    }, 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [step, refreshBalance]);

  const wrongChain = isConnected && chainId !== base.id;
  const ready =
    isAuthenticated && isConnected && !wrongChain && isVaultConfigured();
  const parsed = safeParseEth(amount);
  const valid = parsed !== null && parsed > BigInt(0) && parsed <= free;
  const inFlight = step === "signing" || step === "submitting" || step === "mining";
  const canSubmit = ready && valid && !inFlight;

  function applyPct(pct: number) {
    if (free === BigInt(0)) return;
    const portion =
      (free * BigInt(Math.round(pct * 10_000))) / BigInt(10_000);
    setAmount(truncEth(formatEther(portion)));
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between font-mono text-[10px] font-black uppercase tracking-widest text-[#5a8068]">
        <span>Available</span>
        <button
          type="button"
          onClick={() => setAmount(truncEth(freeEth))}
          className="text-[#8aa393] hover:text-[#00ff66]"
        >
          {truncEth(freeEth)} ETH · max
        </button>
      </div>

      <AmountInput
        label="Amount"
        value={amount}
        onChange={setAmount}
        unit="ETH"
        disabled={inFlight}
      />

      <div className="grid grid-cols-4 gap-2">
        {WITHDRAW_PRESETS_PCT.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => applyPct(p)}
            className="h-9 rounded-md border border-[#1d3327] bg-[#040b0f] font-mono text-xs font-black uppercase tracking-widest text-[#8aa393] transition hover:border-[#00ff66]/50 hover:text-[#00ff66]"
          >
            {Math.round(p * 100)}%
          </button>
        ))}
      </div>

      <Guidance
        connected={isConnected}
        authed={isAuthenticated}
        wrongChain={wrongChain}
        configured={isVaultConfigured()}
        valid={valid}
        amount={amount}
        extra={
          parsed !== null && parsed > free
            ? "Amount above free balance"
            : null
        }
      />

      <button
        type="button"
        disabled={!canSubmit}
        onClick={() => void withdraw(amount)}
        className={`flex h-12 items-center justify-center rounded-lg font-mono text-sm font-black uppercase tracking-widest transition ${
          canSubmit
            ? "bg-[#00ff66] text-[#02260f] shadow-[0_0_24px_rgba(0,255,102,0.32)] hover:brightness-110"
            : "cursor-not-allowed bg-[#0a1612] text-[#3f5a4d]"
        }`}
      >
        {step === "signing"
          ? "Signing authorization…"
          : step === "submitting"
          ? "Confirm in wallet…"
          : step === "mining"
          ? "Mining…"
          : step === "done"
          ? "Withdrawn ✓"
          : "Withdraw ETH"}
      </button>

      <FlowResult
        hash={hash}
        error={error}
        success={step === "done"}
        reset={reset}
      />
    </section>
  );
}

// ── Shared input ───────────────────────────────────────────────────

function AmountInput({
  label,
  value,
  onChange,
  unit,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  unit: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex h-14 items-center rounded-md border bg-[#020806] px-4 shadow-[inset_0_0_18px_rgba(0,255,102,0.03)] transition ${
        disabled ? "border-[#10251d] opacity-60" : "border-[#183229]"
      }`}
    >
      <input
        inputMode="decimal"
        type="text"
        value={value}
        onChange={(e) => onChange(sanitizeAmount(e.target.value))}
        disabled={disabled}
        placeholder="0.00"
        className="min-w-0 flex-1 bg-transparent font-mono text-2xl font-black text-white outline-none placeholder:text-[#3f5a4d] disabled:cursor-not-allowed"
        aria-label={label}
      />
      <span className="font-mono text-xs font-bold text-[#8aa393]">{unit}</span>
    </label>
  );
}

// ── Guidance / error / hash strip ──────────────────────────────────

function Guidance({
  connected,
  authed,
  wrongChain,
  configured,
  valid,
  amount,
  extra,
}: {
  connected: boolean;
  authed: boolean;
  wrongChain: boolean;
  configured: boolean;
  valid: boolean;
  amount: string;
  extra?: string | null;
}) {
  const msg = useMemo(() => {
    if (!configured)
      return {
        tone: "warn" as const,
        text: "Vault not deployed yet — set NEXT_PUBLIC_VAULT_ADDRESS",
      };
    if (!connected) return { tone: "warn" as const, text: "Connect a wallet to continue" };
    if (wrongChain)
      return { tone: "warn" as const, text: "Switch network to Base mainnet" };
    if (!authed)
      return { tone: "warn" as const, text: "Sign in with Ethereum to continue" };
    if (extra) return { tone: "warn" as const, text: extra };
    if (amount && !valid)
      return { tone: "warn" as const, text: "Amount must be ≥ 0.001 and ≤ available" };
    return null;
  }, [connected, authed, wrongChain, configured, valid, amount, extra]);

  if (!msg) return null;
  return (
    <div className="rounded-md border border-[#33211d] bg-[#1a0d0a]/60 px-3 py-2 font-mono text-[11px] font-bold text-[#ff9a3b]">
      {msg.text}
    </div>
  );
}

function FlowResult({
  hash,
  error,
  success,
  reset,
}: {
  hash: `0x${string}` | null;
  error: string | null;
  success: boolean;
  reset: () => void;
}) {
  if (error) {
    return (
      <div className="flex items-start justify-between gap-2 rounded-md border border-[#3f1d20] bg-[#1a0a0c] px-3 py-2 font-mono text-[11px] font-bold text-[#ff3b4d]">
        <span className="break-words">{error}</span>
        <button
          type="button"
          onClick={reset}
          className="shrink-0 text-[#ff3b4d]/70 hover:text-[#ff3b4d]"
        >
          dismiss
        </button>
      </div>
    );
  }
  if (hash) {
    return (
      <a
        href={`${BLOCK_EXPLORER_TX}/${hash}`}
        target="_blank"
        rel="noreferrer"
        className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 font-mono text-[11px] font-bold transition ${
          success
            ? "border-[#1aff84]/35 bg-[#06361b]/40 text-[#00ff66] hover:bg-[#06361b]/70"
            : "border-[#1d3327] bg-[#040b0f] text-[#8aa393] hover:text-[#00ff66]"
        }`}
      >
        <span>tx · {shortHash(hash)}</span>
        <ExternalLink className="h-3 w-3" />
      </a>
    );
  }
  return null;
}

// ── Footer ─────────────────────────────────────────────────────────

function VaultFooter() {
  if (!isVaultConfigured()) return null;
  return (
    <div className="mt-2 flex items-center justify-between border-t border-[#10251d] pt-3 font-mono text-[10px] font-black uppercase tracking-widest text-[#5a8068]">
      <span>Vault contract</span>
      <a
        href={`${BLOCK_EXPLORER_ADDRESS}/${TRADING_VAULT_ADDRESS}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-[#8aa393] hover:text-[#00ff66]"
      >
        {shortAddress(TRADING_VAULT_ADDRESS)} <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────

function safeBig(s: string | undefined | null): bigint {
  if (!s) return BigInt(0);
  try {
    return BigInt(s);
  } catch {
    return BigInt(0);
  }
}

function safeEth(weiStr: string): string {
  return truncEth(formatEther(safeBig(weiStr)));
}

function safeParseEth(s: string): bigint | null {
  if (!s.trim()) return null;
  try {
    return parseEther(s as `${number}`);
  } catch {
    return null;
  }
}

function truncEth(s: string): string {
  // Keep at most 6 decimals — UX nicety, not a precision concession.
  const [int, dec] = s.split(".");
  if (!dec) return int;
  return `${int}.${dec.slice(0, 6)}`;
}

function sanitizeAmount(input: string): string {
  // Allow only digits + a single dot. Strip everything else.
  const cleaned = input.replace(/[^\d.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned;
  return (
    cleaned.slice(0, firstDot + 1) +
    cleaned.slice(firstDot + 1).replace(/\./g, "")
  );
}

function shortAddress(a: string): string {
  if (!a) return "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function shortHash(h: string | null): string {
  if (!h) return "—";
  return `${h.slice(0, 10)}…${h.slice(-6)}`;
}
