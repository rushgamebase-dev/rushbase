"use client";

import { useState, useEffect, useRef } from "react";
import { useAccount, useBalance } from "wagmi";
import { formatEther } from "viem";
import { useWalletModal } from "@/components/layout/WalletButton";
import { usePlaceBet } from "@/hooks/usePlaceBet";
import type { Market, Outcome } from "@/types/market";

interface TradingPanelProps {
  market: Market;
  outcomes: Outcome[];
  flashingIds: Set<string>;
  onBetPlaced?: () => void;
}

const QUICK_AMOUNTS = [0.001, 0.005, 0.01, 0.05];

function Spinner() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 14,
        height: 14,
        borderRadius: "50%",
        border: "2px solid rgba(0,0,0,0.3)",
        borderTopColor: "#000",
        animation: "spin 0.7s linear infinite",
        flexShrink: 0,
      }}
    />
  );
}

type BuySell = "buy" | "sell";

export default function TradingPanel({
  market,
  outcomes,
  flashingIds,
  onBetPlaced,
}: TradingPanelProps) {
  const { address, isConnected } = useAccount();
  const { data: balanceData } = useBalance({ address });
  const { open: openWalletModal, isOpen: isModalOpen, close: closeWalletModal } = useWalletModal();
  const { placeBet, isLoading, isSuccess, error, txHash, reset } = usePlaceBet(market.address);

  const [buySell, setBuySell] = useState<BuySell>("buy");
  const [selectedOutcomeId, setSelectedOutcomeId] = useState<string | null>(
    outcomes.length > 0 ? outcomes[0].id : null
  );
  const [amount, setAmount] = useState("");
  const [showSuccessBanner, setShowSuccessBanner] = useState(false);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ethBalance = balanceData ? parseFloat(formatEther(balanceData.value)) : null;
  const amountNum = parseFloat(amount) || 0;
  const isMarketOpen = market.status === "open";

  const selectedOutcome = outcomes.find((o) => o.id === selectedOutcomeId) ?? outcomes[0] ?? null;
  const potentialReturn =
    selectedOutcome && amountNum > 0 ? amountNum * selectedOutcome.odds : 0;

  // Auto-select first outcome on load
  useEffect(() => {
    if (!selectedOutcomeId && outcomes.length > 0) {
      setSelectedOutcomeId(outcomes[0].id);
    }
  }, [outcomes, selectedOutcomeId]);

  // Success lifecycle
  useEffect(() => {
    if (isSuccess && txHash) {
      setShowSuccessBanner(true);
      if (onBetPlaced) onBetPlaced();
      successTimerRef.current = setTimeout(() => setShowSuccessBanner(false), 5000);
      resetTimerRef.current = setTimeout(() => {
        reset();
        setAmount("");
      }, 3000);
    }
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, [isSuccess, txHash, onBetPlaced, reset]);

  async function handleBet() {
    if (!isConnected) {
      openWalletModal();
      return;
    }
    if (!selectedOutcome || !amountNum || !isMarketOpen || isLoading) return;
    await placeBet(
      selectedOutcome.id,
      selectedOutcome.label,
      amount,
      selectedOutcome.odds
    );
  }

  // Yes/No prices
  const yesProb = selectedOutcome?.probability ?? 50;
  const noProb = Math.max(0, 100 - yesProb);

  function renderCTA() {
    const base: React.CSSProperties = {
      width: "100%",
      height: 48,
      borderRadius: 12,
      border: "none",
      fontSize: "0.85rem",
      fontWeight: 700,
      letterSpacing: "0.04em",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      transition: "all 0.15s",
    };

    if (!isConnected) {
      return (
        <button
          style={{ ...base, background: "var(--primary)", color: "#000" }}
          onClick={openWalletModal}
          className="btn-primary neon-glow"
          aria-label="Connect wallet to trade"
        >
          Sign up to trade
        </button>
      );
    }

    if (!isMarketOpen) {
      return (
        <button
          style={{ ...base, background: "#1a1a1a", color: "var(--muted)", cursor: "not-allowed" }}
          disabled
          aria-disabled="true"
        >
          Market closed
        </button>
      );
    }

    if (isSuccess) {
      return (
        <button
          style={{ ...base, background: "#00cc60", color: "#000" }}
          disabled
          aria-live="polite"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Confirmed!
        </button>
      );
    }

    if (isLoading) {
      return (
        <button
          style={{ ...base, background: "var(--primary)", color: "#000", opacity: 0.85, cursor: "wait" }}
          disabled
          aria-busy="true"
        >
          <Spinner />
          Confirming...
        </button>
      );
    }

    const canBet = selectedOutcome && amountNum > 0;

    return (
      <button
        style={{
          ...base,
          background: "var(--primary)",
          color: "#000",
          opacity: canBet ? 1 : 0.4,
          cursor: canBet ? "pointer" : "not-allowed",
        }}
        disabled={!canBet}
        onClick={canBet ? handleBet : undefined}
        className={canBet ? "btn-primary neon-glow" : ""}
        aria-label={
          !selectedOutcome
            ? "Select an outcome"
            : !amountNum
            ? "Enter an amount"
            : `Place bet on ${selectedOutcome.label}`
        }
        aria-disabled={!canBet}
      >
        {!selectedOutcome
          ? "Select outcome"
          : !amountNum
          ? "Enter amount"
          : `Place ${buySell === "buy" ? "buy" : "sell"} order`}
      </button>
    );
  }

  return (
    <div
      className="flex flex-col"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 20,
        gap: 16,
      }}
      role="region"
      aria-label="Trading panel"
    >
      {/* Market title + selected outcome */}
      <div>
        <p
          className="text-xs mb-1"
          style={{ color: "var(--muted)" }}
        >
          {market.title.length > 48
            ? market.title.slice(0, 48) + "…"
            : market.title}
        </p>
        {selectedOutcome && (
          <p
            className="text-sm font-bold"
            style={{ color: "var(--primary)" }}
          >
            {buySell === "buy" ? "Buy Yes" : "Sell Yes"} · {selectedOutcome.label}
          </p>
        )}
      </div>

      {/* Buy / Sell toggle */}
      <div
        className="flex"
        style={{
          background: "#0d0d0d",
          borderRadius: 8,
          padding: 3,
          gap: 3,
        }}
        role="group"
        aria-label="Buy or sell"
      >
        {(["buy", "sell"] as BuySell[]).map((mode) => (
          <button
            key={mode}
            onClick={() => setBuySell(mode)}
            style={{
              flex: 1,
              padding: "7px 12px",
              borderRadius: 6,
              border: "none",
              fontSize: "0.78rem",
              fontWeight: 700,
              cursor: "pointer",
              background: buySell === mode ? "var(--surface)" : "transparent",
              color:
                buySell === mode
                  ? mode === "buy"
                    ? "var(--primary)"
                    : "var(--danger)"
                  : "var(--muted)",
              boxShadow:
                buySell === mode
                  ? "0 1px 3px rgba(0,0,0,0.4)"
                  : "none",
              transition: "all 0.15s",
              letterSpacing: "0.04em",
            }}
            aria-pressed={buySell === mode}
          >
            {mode === "buy" ? "Buy" : "Sell"}
          </button>
        ))}

        {/* Currency label */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            paddingLeft: 8,
            paddingRight: 4,
            color: "var(--muted)",
            fontSize: "0.75rem",
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          ETH
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </div>

      {/* Yes / No price buttons */}
      {outcomes.length <= 2 ? (
        <div className="flex gap-2" role="group" aria-label="Choose Yes or No">
          {/* Yes */}
          <button
            onClick={() =>
              setSelectedOutcomeId(outcomes[0]?.id ?? null)
            }
            disabled={!isMarketOpen}
            style={{
              flex: 1,
              padding: "12px 8px",
              borderRadius: 999,
              border:
                selectedOutcomeId === (outcomes[0]?.id ?? "")
                  ? "2px solid var(--primary)"
                  : "1px solid rgba(0,255,136,0.3)",
              background:
                selectedOutcomeId === (outcomes[0]?.id ?? "")
                  ? "rgba(0,255,136,0.1)"
                  : "transparent",
              color: "var(--primary)",
              fontSize: "1rem",
              fontWeight: 800,
              cursor: isMarketOpen ? "pointer" : "not-allowed",
              transition: "all 0.15s",
              textAlign: "center",
              opacity: !isMarketOpen ? 0.5 : 1,
            }}
            aria-pressed={selectedOutcomeId === outcomes[0]?.id}
            aria-label={`Yes at ${yesProb} cents`}
          >
            Yes {yesProb}¢
          </button>

          {/* No */}
          <button
            onClick={() =>
              setSelectedOutcomeId(outcomes[1]?.id ?? outcomes[0]?.id ?? null)
            }
            disabled={!isMarketOpen}
            style={{
              flex: 1,
              padding: "12px 8px",
              borderRadius: 999,
              border:
                outcomes[1] && selectedOutcomeId === outcomes[1].id
                  ? "2px solid var(--danger)"
                  : "1px solid rgba(255,68,68,0.3)",
              background:
                outcomes[1] && selectedOutcomeId === outcomes[1].id
                  ? "rgba(255,68,68,0.1)"
                  : "transparent",
              color: "var(--danger)",
              fontSize: "1rem",
              fontWeight: 800,
              cursor: isMarketOpen ? "pointer" : "not-allowed",
              transition: "all 0.15s",
              textAlign: "center",
              opacity: !isMarketOpen ? 0.5 : 1,
            }}
            aria-pressed={outcomes[1] ? selectedOutcomeId === outcomes[1].id : false}
            aria-label={`No at ${noProb} cents`}
          >
            No {noProb}¢
          </button>
        </div>
      ) : (
        /* Multi-outcome: compact select */
        <div className="flex flex-col gap-1.5" role="group" aria-label="Select outcome">
          {outcomes.map((o, idx) => {
            const isSelected = selectedOutcomeId === o.id;
            const isFlashing = flashingIds.has(o.id);
            const dotColors = [
              "var(--primary)",
              "var(--danger)",
              "var(--gold)",
              "#4488ff",
              "#aa44ff",
            ];
            const c = dotColors[idx % dotColors.length];
            return (
              <button
                key={o.id}
                onClick={() => setSelectedOutcomeId(isSelected ? null : o.id)}
                disabled={!isMarketOpen}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: isSelected ? `1px solid ${c}` : "1px solid var(--border)",
                  background: isSelected ? `${c}18` : "transparent",
                  cursor: isMarketOpen ? "pointer" : "not-allowed",
                  transition: "all 0.15s",
                  opacity: !isMarketOpen ? 0.5 : 1,
                  textAlign: "left",
                }}
                aria-pressed={isSelected}
                aria-label={`${o.label} — ${o.probability}%`}
              >
                <span
                  style={{ width: 8, height: 8, borderRadius: "50%", background: c, flexShrink: 0 }}
                  aria-hidden="true"
                />
                <span style={{ flex: 1, fontSize: "0.8rem", fontWeight: 600, color: "var(--text)" }}>
                  {o.label}
                </span>
                <span
                  className={`tabular ${isFlashing ? "odds-flash" : ""}`}
                  style={{ fontSize: "0.85rem", fontWeight: 800, color: c }}
                >
                  {o.probability}%
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Amount input */}
      <div>
        <div
          className="flex items-center justify-between"
          style={{
            background: "#0d0d0d",
            borderRadius: 8,
            border: "1px solid var(--border)",
            padding: "10px 14px",
          }}
        >
          <label
            htmlFor="trading-amount"
            className="text-sm"
            style={{ color: "var(--muted)" }}
          >
            Amount
          </label>
          <input
            id="trading-amount"
            type="text"
            inputMode="decimal"
            placeholder="0"
            value={amount}
            onChange={(e) => {
              const v = e.target.value;
              if (/^[\d]*\.?[\d]*$/.test(v)) setAmount(v);
            }}
            disabled={!isMarketOpen || isLoading}
            style={{
              background: "transparent",
              border: "none",
              outline: "none",
              textAlign: "right",
              fontSize: "1.1rem",
              fontWeight: 800,
              color: "var(--text)",
              width: 120,
              fontVariantNumeric: "tabular-nums",
            }}
            aria-label="Bet amount in ETH"
          />
        </div>

        {/* Interest line */}
        {amountNum > 0 && (
          <p
            className="text-xs mt-1.5"
            style={{ color: "var(--primary)" }}
            aria-live="polite"
          >
            Potential return:{" "}
            <strong>{potentialReturn.toFixed(4)} ETH</strong>
          </p>
        )}
      </div>

      {/* CTA */}
      {renderCTA()}

      {/* Quick amounts */}
      <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Quick amounts">
        {QUICK_AMOUNTS.map((v) => (
          <button
            key={v}
            onClick={() => setAmount(String(v))}
            disabled={!isMarketOpen || isLoading}
            style={{
              padding: "4px 10px",
              borderRadius: 999,
              border:
                amount === String(v)
                  ? "1px solid rgba(0,255,136,0.5)"
                  : "1px solid var(--border)",
              background: "transparent",
              color: amount === String(v) ? "var(--primary)" : "var(--muted)",
              fontSize: "0.72rem",
              fontWeight: 600,
              cursor: isMarketOpen ? "pointer" : "not-allowed",
              opacity: !isMarketOpen ? 0.5 : 1,
              transition: "all 0.12s",
            }}
            onMouseEnter={(e) => {
              if (isMarketOpen && amount !== String(v)) {
                const el = e.currentTarget as HTMLElement;
                el.style.borderColor = "rgba(0,255,136,0.3)";
                el.style.color = "var(--text)";
              }
            }}
            onMouseLeave={(e) => {
              if (amount !== String(v)) {
                const el = e.currentTarget as HTMLElement;
                el.style.borderColor = "var(--border)";
                el.style.color = "var(--muted)";
              }
            }}
            aria-label={`${v} ETH`}
          >
            {v}
          </button>
        ))}
        {isConnected && ethBalance !== null && (
          <button
            onClick={() => setAmount(ethBalance.toFixed(4))}
            disabled={!isMarketOpen || isLoading}
            style={{
              padding: "4px 10px",
              borderRadius: 999,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--muted)",
              fontSize: "0.72rem",
              fontWeight: 600,
              cursor: isMarketOpen ? "pointer" : "not-allowed",
              opacity: !isMarketOpen ? 0.5 : 1,
              transition: "all 0.12s",
            }}
            onMouseEnter={(e) => {
              if (isMarketOpen) {
                const el = e.currentTarget as HTMLElement;
                el.style.borderColor = "rgba(0,255,136,0.3)";
                el.style.color = "var(--text)";
              }
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLElement;
              el.style.borderColor = "var(--border)";
              el.style.color = "var(--muted)";
            }}
            aria-label="Use max balance"
          >
            MAX
          </button>
        )}
      </div>

      {/* Balance row */}
      {isConnected && ethBalance !== null && (
        <p
          className="text-xs"
          style={{ color: "var(--muted)", textAlign: "center" }}
          aria-label={`Wallet balance: ${ethBalance.toFixed(4)} ETH`}
        >
          Balance: {ethBalance.toFixed(4)} ETH
        </p>
      )}

      {/* Success banner */}
      {showSuccessBanner && txHash && (
        <div
          className="rounded-lg p-3 animate-fade-in-up"
          style={{
            background: "rgba(0,255,136,0.08)",
            border: "1px solid rgba(0,255,136,0.3)",
          }}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold" style={{ color: "var(--primary)" }}>
              BET CONFIRMED
            </span>
            <button
              onClick={() => setShowSuccessBanner(false)}
              aria-label="Close"
              style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 2 }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <a
            href={`https://basescan.org/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs flex items-center gap-1"
            style={{ color: "var(--muted)" }}
            aria-label={`View tx on Basescan`}
          >
            {txHash.slice(0, 10)}...{txHash.slice(-6)}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
        </div>
      )}

      {/* Error banner */}
      {error && !isLoading && (
        <div
          className="rounded-lg p-3 animate-fade-in-up"
          style={{
            background: "rgba(255,68,68,0.08)",
            border: "1px solid rgba(255,68,68,0.3)",
          }}
          role="alert"
          aria-live="assertive"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs" style={{ color: "var(--danger)" }}>
              {error}
            </span>
            <button
              onClick={reset}
              aria-label="Dismiss error"
              style={{ background: "none", border: "none", color: "var(--danger)", cursor: "pointer", padding: 2, opacity: 0.7 }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = "1")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = "0.7")}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Wallet modal */}
      {isModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Connect Wallet"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            background: "rgba(0,0,0,0.78)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeWalletModal();
          }}
        >
          <div
            className="animate-fade-in-up w-full"
            style={{
              maxWidth: 360,
              background: "#111",
              border: "1px solid rgba(0,255,136,0.2)",
              borderRadius: 12,
              boxShadow: "0 0 40px rgba(0,255,136,0.07), 0 24px 48px rgba(0,0,0,0.65)",
              padding: 24,
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-black tracking-widest" style={{ color: "#e0e0e0" }}>
                CONNECT WALLET
              </p>
              <button
                onClick={closeWalletModal}
                aria-label="Close"
                style={{
                  width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center",
                  borderRadius: "50%", background: "#1a1a1a", border: "none", color: "#666", cursor: "pointer",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <p className="text-xs text-center" style={{ color: "var(--muted)" }}>
              Use the CONNECT button in the header to connect your wallet.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
