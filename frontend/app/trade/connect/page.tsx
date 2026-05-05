"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useConnect } from "wagmi";
import { useTapTradeAuth } from "@/hooks/use-taptrade-auth";

/**
 * Wallet connect + SIWE landing for the TapTrade arena.
 *
 * Doubles as the marketing surface for first-time visitors:
 *   - Hero block explains the core mechanic (tap a band, snake hits → win)
 *   - 3 feature cards cover provably-fair, real-ETH, mobile-first
 *   - Connect wallet only appears after the user clicks CTA, so the
 *     entry experience isn't a wall of wallet buttons
 *
 * Flow:
 *  1. User clicks PLAY NOW → wallet picker reveals
 *  2. Picks connector → wallet handshake
 *  3. Once connected, SIWE signature → engine /auth/siwe/{nonce,verify}
 *  4. `taptrade_access_token` cookie set → redirect to /trade
 *
 * The TapTrade auth cookie is intentionally separate from any other
 * Rush auth (predict/tiles uses a different backend).
 */
export default function ConnectPage() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { connect, connectors, status } = useConnect();
  const { isAuthenticated, isSigningIn, signIn, error } = useTapTradeAuth();
  const [showConnectors, setShowConnectors] = useState(false);

  useEffect(() => {
    if (isAuthenticated) router.replace("/trade");
  }, [isAuthenticated, router]);

  // Reveal connectors automatically once the user is connected so
  // they don't get stuck on the CTA after the wallet picker closes.
  useEffect(() => {
    if (isConnected) setShowConnectors(true);
  }, [isConnected]);

  return (
    <div className="min-h-screen bg-[#02070b] text-white">
      {/* Ambient background grid — pure CSS, no images, mobile-cheap */}
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(#00ff66 1px, transparent 1px), linear-gradient(90deg, #00ff66 1px, transparent 1px)",
          backgroundSize: "44px 44px",
        }}
        aria-hidden="true"
      />

      <main className="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-start gap-8 px-5 pb-16 pt-10 sm:pt-16">
        {/* ── Hero ──────────────────────────────────────────────── */}
        <section className="flex w-full flex-col items-center gap-2 text-center">
          {/* Mascot — animated skunk in a leather jacket holding 4 aces.
              Transparent background, ~580 px tall. Sits in a soft
              radial glow so the dark page doesn't swallow it. */}
          <div className="relative flex h-44 w-44 items-center justify-center sm:h-56 sm:w-56">
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background:
                  "radial-gradient(circle, rgba(0,255,102,0.22) 0%, rgba(0,255,102,0.08) 38%, transparent 70%)",
              }}
              aria-hidden="true"
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/taptrade/mascot.gif"
              alt="Rush mascot — confident skunk holding four aces"
              className="relative h-full w-full object-contain drop-shadow-[0_8px_32px_rgba(0,0,0,0.6)]"
            />
          </div>

          <h1 className="font-mono text-3xl font-black tracking-[0.18em] text-white sm:text-4xl">
            <span className="text-[#00ff66]">RUSH</span> · TapTrading
          </h1>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.32em] text-[#00ff66]/80">
            Provably-fair price-touch arena · Base mainnet
          </p>
          <p className="mt-1 max-w-xl font-mono text-sm leading-relaxed text-[#b8c7d9]">
            Tap a price band. If the snake touches it during your window,{" "}
            <span className="font-black text-[#00ff66]">you win</span>. Real
            ETH, real time, no paper. Single line, no hidden RNG, every bet
            verifiable on-chain.
          </p>
        </section>

        {/* ── Big CTA ──────────────────────────────────────────── */}
        {!isAuthenticated && (
          <section className="w-full max-w-md">
            {!showConnectors && !isConnected ? (
              <button
                onClick={() => setShowConnectors(true)}
                className="group relative flex h-16 w-full items-center justify-center gap-3 overflow-hidden rounded-xl border-2 border-[#00ff66] bg-gradient-to-b from-[#00ff66] to-[#00cc55] font-mono text-base font-black uppercase tracking-[0.32em] text-[#02260f] shadow-[0_0_36px_rgba(0,255,102,0.45)] transition hover:scale-[1.02] hover:shadow-[0_0_56px_rgba(0,255,102,0.65)] active:scale-[0.98] sm:h-18 sm:text-lg"
              >
                <span className="absolute inset-0 -translate-x-full bg-white/20 transition-transform duration-700 group-hover:translate-x-full" />
                <span className="relative">▶ PLAY NOW</span>
              </button>
            ) : !isConnected ? (
              <div className="space-y-3">
                <p className="text-center font-mono text-xs uppercase tracking-[0.22em] text-[#8aa393]">
                  Choose your wallet
                </p>
                {connectors.map((c) => (
                  <button
                    key={c.uid}
                    onClick={() => connect({ connector: c })}
                    disabled={status === "pending"}
                    className="flex w-full items-center justify-center rounded-lg border border-[#1aff84]/40 bg-[#040b0f] py-4 font-mono text-sm font-black uppercase tracking-[0.22em] text-[#00ff66] transition hover:border-[#00ff66] hover:bg-[#06361b]/40 disabled:opacity-50"
                  >
                    {c.name}
                  </button>
                ))}
                <button
                  onClick={() => setShowConnectors(false)}
                  className="w-full text-center font-mono text-[10px] uppercase tracking-[0.22em] text-[#5a8068] transition hover:text-[#8aa393]"
                >
                  ← back
                </button>
              </div>
            ) : (
              <section className="space-y-3 text-center">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-[#5a8068]">
                  Connected as
                </p>
                <p className="break-all font-mono text-xs font-bold text-[#00ff66]">
                  {address}
                </p>
                <button
                  onClick={() => void signIn()}
                  disabled={isSigningIn}
                  className="flex h-14 w-full items-center justify-center rounded-xl border-2 border-[#00ff66] bg-gradient-to-b from-[#00ff66] to-[#00cc55] font-mono text-sm font-black uppercase tracking-[0.32em] text-[#02260f] shadow-[0_0_36px_rgba(0,255,102,0.45)] transition hover:scale-[1.02] active:scale-[0.98] disabled:cursor-wait disabled:opacity-70"
                >
                  {isSigningIn ? "Awaiting signature…" : "Sign in with Ethereum"}
                </button>
                <p className="font-mono text-[10px] text-[#5a8068]">
                  EIP-4361 — no transaction, no gas. Just a signature so the
                  engine can issue a 15-minute session JWT.
                </p>
              </section>
            )}

            {error && (
              <p className="mt-3 break-all rounded-lg border border-[#ff3b4d]/40 bg-[#1a0a0c] px-3 py-2 text-center font-mono text-xs font-bold text-[#ff3b4d]">
                {error}
              </p>
            )}
          </section>
        )}

        {/* ── How it works ─────────────────────────────────────── */}
        <section className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
          <Step
            n="01"
            title="Pick a cell"
            body="Each cell on the grid is a price band × time window. Closer = lower payout, farther = higher."
          />
          <Step
            n="02"
            title="Tap to bet"
            body="Stake locks. Your cell highlights and stays pinned to its absolute price level — the snake doesn't move it."
          />
          <Step
            n="03"
            title="Snake hits = win"
            body="If the live price line crosses your band during the window, the multiplier pays out. Auto-credited."
          />
        </section>

        {/* ── Trust strip ──────────────────────────────────────── */}
        <section className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3">
          <Trust label="On-chain custody" body="ETH lives in the TradingVault contract on Base. Withdrawals require an engine-signed authorization." />
          <Trust label="Provably fair" body="One global snake, same path for everyone, every resolution audited via path hash." />
          <Trust label="Mobile native" body="Touch-first canvas. Works in MetaMask, Rainbow, Coinbase wallets." />
        </section>

        <footer className="mt-2 text-center font-mono text-[10px] uppercase tracking-[0.28em] text-[#5a8068]">
          Built by Rush · 100% own infra · Base mainnet
        </footer>
      </main>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="rounded-lg border border-[#10251d] bg-[#040b0f] p-4 transition hover:border-[#00ff66]/40">
      <div className="font-mono text-[10px] font-black tracking-[0.32em] text-[#00ff66]">
        {n}
      </div>
      <div className="mt-2 font-mono text-base font-black text-white">
        {title}
      </div>
      <p className="mt-1.5 font-mono text-xs leading-relaxed text-[#8aa393]">
        {body}
      </p>
    </div>
  );
}

function Trust({ label, body }: { label: string; body: string }) {
  return (
    <div className="rounded-lg border border-[#10251d] bg-[#02070b] p-3">
      <div className="font-mono text-[9px] font-black uppercase tracking-[0.32em] text-[#00ff66]/80">
        {label}
      </div>
      <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-[#7b9186]">
        {body}
      </p>
    </div>
  );
}
