"use client";

import { useState, useEffect, useRef } from "react";
import { ExternalLink } from "lucide-react";
import { useAccount, useBalance, useReadContract } from "wagmi";
import { useWalletModal } from "@/components/WalletButton";
import { formatEther } from "viem";
import type { Bet, LiveMarket } from "@/lib/mock";
import { timeAgo } from "@/lib/mock";
import { usePlaceBet } from "@/hooks/usePlaceBet";
import { BASE_MAINNET, MARKET_ABI } from "@/lib/contracts";
import ClaimSection from "@/components/ClaimSection";
import { useClaimWinnings } from "@/hooks/useClaimWinnings";

interface BettingPanelProps {
  market: LiveMarket;
  marketAddress?: `0x${string}` | null;
  /** 0 = UNDER wins, 1 = OVER wins, -1 = unknown */
  winningRangeIndex?: number;
  /** Unix timestamp (seconds) when betting closes on-chain */
  lockTime?: number;
}

const QUICK_AMOUNTS = [0.001, 0.005, 0.01, 0.05];

function formatEth(n: number): string {
  if (n === 0) return "0";
  if (n < 0.001) return n.toFixed(5);
  if (n < 0.1) return n.toFixed(3);
  return n.toFixed(2);
}

export default function BettingPanel({ market, marketAddress, winningRangeIndex = -1, lockTime = 0 }: BettingPanelProps) {
  const { address: walletAddress, isConnected } = useAccount();
  useClaimWinnings(marketAddress ?? null); // keep hook active for claim polling
  const { openModal: openConnectModal, WalletModalComponent } = useWalletModal();
  const { data: balanceData } = useBalance({ address: walletAddress });

  // Read user's bets for this market (to show personalized result)
  const { data: userBetsData } = useReadContract({
    address: marketAddress || undefined,
    abi: MARKET_ABI,
    functionName: "getUserBets",
    args: walletAddress ? [walletAddress] : undefined,
    query: { enabled: !!marketAddress && !!walletAddress && market.status === "resolved" },
  });

  const {
    placeBet: placeBetContract,
    isLoading: isBetLoading,
    isSuccess: isBetSuccess,
    txHash: betTxHash,
    // reset available via usePlaceBet but not needed here
  } = usePlaceBet(marketAddress ?? null);

  const [selectedSide, setSelectedSide] = useState<"over" | "under" | null>(null);
  const [amount, setAmount] = useState("");
  const [isPlacing, setIsPlacing] = useState(false);
  const [lastBetIds, setLastBetIds] = useState<Set<string>>(new Set());
  const [flashBetId, setFlashBetId] = useState<string | null>(null);
  const prevOverOddsRef = useRef(market.overOdds);
  const prevUnderOddsRef = useRef(market.underOdds);
  const [overOddsFlash, setOverOddsFlash] = useState(false);
  const [underOddsFlash, setUnderOddsFlash] = useState(false);
  const betsListRef = useRef<HTMLDivElement>(null);
  const [betsWithAge, setBetsWithAge] = useState<Bet[]>([]);
  const [showTxSuccess, setShowTxSuccess] = useState(false);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);

  // Enforce the SAME rule as the contract: require(block.timestamp < lockTime)
  // This prevents users from clicking bet when the chain would revert anyway.
  const bettingExpired = lockTime > 0 && Math.floor(Date.now() / 1000) >= lockTime;
  const isOpen = market.status === "open" && !bettingExpired;
  const amountNum = parseFloat(amount) || 0;
  const canBet = isOpen && selectedSide !== null && amountNum >= 0.001 && amountNum <= 10;

  const selectedOdds = selectedSide === "over" ? market.overOdds : market.underOdds;
  const potentialReturn = amountNum > 0 ? amountNum * selectedOdds : 0;
  const profit = potentialReturn - amountNum;

  const ethBalance = balanceData ? parseFloat(formatEther(balanceData.value)) : null;

  // Handle successful bet
  useEffect(() => {
    if (isBetSuccess && betTxHash) {
      setLastTxHash(betTxHash);
      setShowTxSuccess(true);
      setAmount("");
      setSelectedSide(null);
      setIsPlacing(false);
      setTimeout(() => setShowTxSuccess(false), 8000);
    }
  }, [isBetSuccess, betTxHash]);

  // Odds flash on change
  useEffect(() => {
    if (market.overOdds !== prevOverOddsRef.current) {
      setOverOddsFlash(true);
      prevOverOddsRef.current = market.overOdds;
      setTimeout(() => setOverOddsFlash(false), 700);
    }
  }, [market.overOdds]);

  useEffect(() => {
    if (market.underOdds !== prevUnderOddsRef.current) {
      setUnderOddsFlash(true);
      prevUnderOddsRef.current = market.underOdds;
      setTimeout(() => setUnderOddsFlash(false), 700);
    }
  }, [market.underOdds]);

  // Detect new bets and flash them
  const lastBetIdsRef = useRef(lastBetIds);
  useEffect(() => {
    const newIds = new Set(market.recentBets.map((b) => b.id));
    const diff = market.recentBets.find((b) => !lastBetIdsRef.current.has(b.id));
    if (diff) {
      setFlashBetId(diff.id);
      setTimeout(() => setFlashBetId(null), 800);
    }
    lastBetIdsRef.current = newIds;
    setLastBetIds(newIds);
    setBetsWithAge(market.recentBets);
  }, [market.recentBets]);

  // Update time-ago every 30s
  useEffect(() => {
    const interval = setInterval(() => {
      setBetsWithAge((prev) =>
        prev.map((b) => ({ ...b, timeAgo: timeAgo(b.timestamp) }))
      );
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  async function handleBet() {
    if (!isConnected) {
      openConnectModal();
      return;
    }
    if (!canBet) return;

    setIsPlacing(true);

    // Map side to range index: over = 1, under = 0 (convention for 2-range markets)
    const rangeIndex = selectedSide === "over" ? 1 : 0;

    await placeBetContract(rangeIndex, amount);
  }

  const statusColor =
    market.status === "open"
      ? "#00ff88"
      : market.status === "locked" || market.status === "resolving"
      ? "#ffaa00"
      : "#888";
  const statusLabel =
    market.status === "open"
      ? "OPEN"
      : market.status === "locked"
      ? "LOCKED"
      : market.status === "resolving"
      ? "RESOLVING"
      : "RESOLVED";

  const explorerUrl = BASE_MAINNET.blockExplorerUrls[0];

  return (
    <>
    <div
      className="flex flex-col h-full overflow-y-auto"
      style={{
        background: "#111",
        borderLeft: "1px solid #1a1a1a",
        borderRight: "1px solid #1a1a1a",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{ borderBottom: "1px solid #1a1a1a" }}
      >
        <div>
          <div
            className="text-xs font-bold tracking-widest"
            style={{ color: "#666", fontFamily: "monospace" }}
          >
            PREDICTION
          </div>
          <div
            className="text-sm font-bold"
            style={{ color: "#e0e0e0", fontFamily: "monospace" }}
          >
            Round #{market.roundId}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {ethBalance !== null && (
            <div
              className="text-xs tabular"
              style={{ color: "#555", fontFamily: "monospace" }}
            >
              {ethBalance.toFixed(4)} ETH
            </div>
          )}
          <div
            className="px-2 py-1 rounded text-xs font-bold tracking-widest"
            style={{
              background: `rgba(${statusColor === "#00ff88" ? "0,255,136" : statusColor === "#ffaa00" ? "255,170,0" : "100,100,100"},0.12)`,
              border: `1px solid ${statusColor}33`,
              color: statusColor,
              fontFamily: "monospace",
            }}
          >
            {statusLabel}
          </div>
        </div>
      </div>

      {/* Tx success banner */}
      {showTxSuccess && lastTxHash && (
        <div
          className="px-4 py-2 flex items-center justify-between animate-fade-in-up"
          style={{ background: "rgba(0,255,136,0.08)", borderBottom: "1px solid rgba(0,255,136,0.2)" }}
        >
          <span className="text-xs font-bold" style={{ color: "#00ff88", fontFamily: "monospace" }}>
            BET CONFIRMED
          </span>
          <a
            href={`${explorerUrl}/tx/${lastTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs flex items-center gap-1 transition-colors"
            style={{ color: "#00ff88", fontFamily: "monospace" }}
          >
            View on Basescan
            <ExternalLink size={10} />
          </a>
        </div>
      )}

      {/* Always show betting interface */}
      {(
        <>

      {/* Question */}
      <div
        className="px-4 py-3 shrink-0"
        style={{ borderBottom: "1px solid #1a1a1a" }}
      >
        <div className="text-sm font-semibold mb-1" style={{ color: "#e0e0e0" }}>
          How many vehicles cross in 5 min?
        </div>
        <div
          className="text-xs"
          style={{ color: "#666", fontFamily: "monospace" }}
        >
          Threshold: <span style={{ color: "#ffd700" }}>{market.threshold} vehicles</span>
        </div>
      </div>

      {/* Outcome buttons */}
      <div className="px-4 py-3 flex flex-col gap-2 shrink-0" style={{ borderBottom: "1px solid #1a1a1a" }}>
        {/* OVER button */}
        <button
          onClick={() => isOpen && setSelectedSide(selectedSide === "over" ? null : "over")}
          disabled={!isOpen}
          className="relative w-full rounded overflow-hidden transition-all"
          style={{
            background: selectedSide === "over"
              ? "rgba(0,255,136,0.15)"
              : "rgba(0,255,136,0.06)",
            border: `2px solid ${selectedSide === "over" ? "#00ff88" : "rgba(0,255,136,0.2)"}`,
            boxShadow: selectedSide === "over" ? "0 0 16px rgba(0,255,136,0.2)" : "none",
            cursor: isOpen ? "pointer" : "not-allowed",
            opacity: isOpen ? 1 : 0.5,
          }}
          aria-pressed={selectedSide === "over"}
          aria-label={`Bet OVER ${market.threshold} — ${market.overOdds}x odds`}
        >
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-lg font-black" style={{ color: "#00ff88" }}>&#9650;</span>
              <div className="text-left">
                <div className="text-sm font-bold" style={{ color: "#00ff88" }}>
                  OVER {market.threshold}
                </div>
                <div className="text-xs" style={{ color: "#aaa" }}>
                  {market.overPct}% of pool
                </div>
              </div>
            </div>
            <div className="text-right">
              <div
                className={`text-lg font-black tabular ${overOddsFlash ? "odds-flash" : ""}`}
                style={{ color: "#00ff88", fontFamily: "monospace" }}
              >
                {market.overOdds > 0 ? `${market.overOdds.toFixed(2)}x` : "—"}
              </div>
              <div className="text-xs" style={{ color: "#555" }}>
                {market.overPool > 0 ? `${formatEth(market.overPool)} ETH` : "No bets yet"}
              </div>
            </div>
          </div>
          {/* Progress bar */}
          <div className="absolute bottom-0 left-0 w-full h-0.5" style={{ background: "#1a1a1a" }}>
            <div
              className="h-full transition-all duration-700"
              style={{
                width: `${market.overPct}%`,
                background: "rgba(0,255,136,0.6)",
              }}
            />
          </div>
        </button>

        {/* UNDER button */}
        <button
          onClick={() => isOpen && setSelectedSide(selectedSide === "under" ? null : "under")}
          disabled={!isOpen}
          className="relative w-full rounded overflow-hidden transition-all"
          style={{
            background: selectedSide === "under"
              ? "rgba(255,68,68,0.15)"
              : "rgba(255,68,68,0.06)",
            border: `2px solid ${selectedSide === "under" ? "#ff4444" : "rgba(255,68,68,0.2)"}`,
            boxShadow: selectedSide === "under" ? "0 0 16px rgba(255,68,68,0.2)" : "none",
            cursor: isOpen ? "pointer" : "not-allowed",
            opacity: isOpen ? 1 : 0.5,
          }}
          aria-pressed={selectedSide === "under"}
          aria-label={`Bet UNDER ${market.threshold} — ${market.underOdds}x odds`}
        >
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-lg font-black" style={{ color: "#ff4444" }}>&#9660;</span>
              <div className="text-left">
                <div className="text-sm font-bold" style={{ color: "#ff4444" }}>
                  UNDER {market.threshold}
                </div>
                <div className="text-xs" style={{ color: "#aaa" }}>
                  {market.underPct}% of pool
                </div>
              </div>
            </div>
            <div className="text-right">
              <div
                className={`text-lg font-black tabular ${underOddsFlash ? "odds-flash" : ""}`}
                style={{ color: "#ff4444", fontFamily: "monospace" }}
              >
                {market.underOdds > 0 ? `${market.underOdds.toFixed(2)}x` : "—"}
              </div>
              <div className="text-xs" style={{ color: "#555" }}>
                {market.underPool > 0 ? `${formatEth(market.underPool)} ETH` : "No bets yet"}
              </div>
            </div>
          </div>
          {/* Progress bar */}
          <div className="absolute bottom-0 left-0 w-full h-0.5" style={{ background: "#1a1a1a" }}>
            <div
              className="h-full transition-all duration-700"
              style={{
                width: `${market.underPct}%`,
                background: "rgba(255,68,68,0.6)",
              }}
            />
          </div>
        </button>
      </div>

      {/* Amount input */}
      <div className="px-4 py-3 shrink-0" style={{ borderBottom: "1px solid #1a1a1a" }}>
        <div className="text-xs font-bold tracking-widest mb-2" style={{ color: "#555", fontFamily: "monospace" }}>
          AMOUNT
        </div>

        {/* Input */}
        <div
          className="flex items-center rounded mb-2"
          style={{
            background: "#0d0d0d",
            border: `1px solid ${amount ? "rgba(0,255,136,0.3)" : "#1a1a1a"}`,
            transition: "border-color 0.15s",
          }}
        >
          <span
            className="pl-3 pr-2 text-sm font-bold shrink-0"
            style={{ color: "#00ff88", fontFamily: "monospace" }}
          >
            ETH
          </span>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            min="0.001"
            max="10"
            step="0.001"
            disabled={!isOpen}
            className="flex-1 bg-transparent py-2.5 pr-3 text-right focus:outline-none tabular"
            style={{
              color: "#e0e0e0",
              fontFamily: "monospace",
              fontSize: 16,
              fontWeight: 700,
            }}
            aria-label="Bet amount in ETH"
          />
        </div>

        {/* Quick amounts */}
        <div className="flex gap-1.5">
          {QUICK_AMOUNTS.map((q) => (
            <button
              key={q}
              onClick={() => setAmount(String(q))}
              disabled={!isOpen}
              className="flex-1 py-1.5 rounded text-xs font-bold transition-all"
              style={{
                background: parseFloat(amount) === q ? "rgba(0,255,136,0.15)" : "#0d0d0d",
                border: `1px solid ${parseFloat(amount) === q ? "rgba(0,255,136,0.4)" : "#1a1a1a"}`,
                color: parseFloat(amount) === q ? "#00ff88" : "#555",
                fontFamily: "monospace",
                cursor: isOpen ? "pointer" : "not-allowed",
              }}
            >
              {q}
            </button>
          ))}
          <button
            onClick={() => {
              if (ethBalance !== null) {
                const maxBet = Math.min(ethBalance * 0.95, 10);
                setAmount(maxBet.toFixed(4));
              } else {
                setAmount("0.5");
              }
            }}
            disabled={!isOpen}
            className="px-2 py-1.5 rounded text-xs font-bold transition-all"
            style={{
              background: "#0d0d0d",
              border: "1px solid #1a1a1a",
              color: "#555",
              fontFamily: "monospace",
              cursor: isOpen ? "pointer" : "not-allowed",
            }}
          >
            MAX
          </button>
        </div>

        {/* Return calculation */}
        {selectedSide && amountNum > 0 && (
          <div
            className="mt-3 p-2 rounded animate-fade-in-up"
            style={{ background: "#0d0d0d", border: "1px solid #1a1a1a" }}
          >
            <div className="flex justify-between text-xs mb-1">
              <span style={{ color: "#555", fontFamily: "monospace" }}>BET</span>
              <span style={{ color: "#aaa", fontFamily: "monospace" }}>
                {amountNum.toFixed(4)} ETH
              </span>
            </div>
            <div className="flex justify-between text-xs mb-1">
              <span style={{ color: "#555", fontFamily: "monospace" }}>ODDS</span>
              <span style={{ color: "#aaa", fontFamily: "monospace" }}>
                {selectedOdds.toFixed(2)}x
              </span>
            </div>
            <div
              className="flex justify-between text-xs pt-1"
              style={{ borderTop: "1px solid #1a1a1a" }}
            >
              <span style={{ color: "#555", fontFamily: "monospace" }}>IF WIN</span>
              <span
                className="font-bold"
                style={{
                  color: "#00ff88",
                  fontFamily: "monospace",
                  textShadow: "0 0 8px rgba(0,255,136,0.4)",
                }}
              >
                +{profit.toFixed(4)} ETH
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Claim winnings section — shown when market is RESOLVED and user has winnings */}
      <ClaimSection
        marketAddress={marketAddress ?? null}
        marketState={market.status === "resolved" ? 2 : market.status === "locked" ? 1 : 0}
      />

      {/* Result section — personalized for winner / loser / spectator */}
      {market.status === "resolved" && (() => {
        const winSide = winningRangeIndex === 1 ? "over" : winningRangeIndex === 0 ? "under" : null;
        const winColor = winSide === "over" ? "#00ff88" : "#ff4444";
        const winLabel = winSide === "over" ? "OVER WINS" : "UNDER WINS";

        // Parse user's bets to determine outcome
        const userBets = (userBetsData as unknown as { rangeIndex: bigint; amount: bigint; claimed: boolean }[] | undefined) ?? [];
        const didParticipate = isConnected && userBets.length > 0;
        const userSide = didParticipate ? (Number(userBets[0].rangeIndex) === 1 ? "over" : "under") : null;
        const userWon = didParticipate && userSide === winSide;
        const userTotalBet = userBets.reduce((sum, b) => sum + Number(formatEther(b.amount)), 0);
        const wasPaid = didParticipate && userBets.some(b => b.claimed);

        return (
          <div className="px-4 py-3 shrink-0 animate-fade-in-up" style={{ borderBottom: "1px solid #1a1a1a" }}>
            {/* Market result */}
            <div className="p-3 rounded mb-2" style={{ background: "#0d0d0d", border: "1px solid #1f1f1f" }}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold tracking-widest" style={{ color: "#555", fontFamily: "monospace" }}>RESULT</span>
                <span className="text-sm font-black" style={{ color: winColor, fontFamily: "monospace", textShadow: `0 0 8px ${winColor}88` }}>{winLabel}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: "#888", fontFamily: "monospace" }}>Final count:</span>
                <span className="text-sm font-black tabular" style={{ color: "#e0e0e0", fontFamily: "monospace" }}>{market.vehicleCount}</span>
              </div>
            </div>

            {/* Personalized outcome */}
            {didParticipate ? (
              userWon ? (
                /* WINNER */
                <div className="p-3 rounded" style={{ background: "rgba(0,255,136,0.06)", border: "1px solid rgba(0,255,136,0.25)", borderRadius: 8 }}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg font-black" style={{ color: "#00ff88" }}>{userSide === "over" ? "\u25B2" : "\u25BC"}</span>
                    <span className="text-sm font-black tracking-widest" style={{ color: "#00ff88", fontFamily: "monospace" }}>YOU WON!</span>
                  </div>
                  <div className="text-xs" style={{ color: "#888", fontFamily: "monospace" }}>
                    You bet {userSide?.toUpperCase()} — {userTotalBet.toFixed(4)} ETH
                  </div>
                  {wasPaid && (
                    <div className="text-xs mt-1 font-bold" style={{ color: "#00ff88", fontFamily: "monospace" }}>
                      Winnings paid automatically to your wallet
                    </div>
                  )}
                </div>
              ) : (
                /* LOSER */
                <div className="p-3 rounded" style={{ background: "rgba(255,68,68,0.04)", border: "1px solid rgba(255,68,68,0.15)", borderRadius: 8 }}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg font-black" style={{ color: "#ff4444" }}>{userSide === "over" ? "\u25B2" : "\u25BC"}</span>
                    <span className="text-sm font-black tracking-widest" style={{ color: "#ff4444", fontFamily: "monospace" }}>YOU LOST</span>
                  </div>
                  <div className="text-xs" style={{ color: "#666", fontFamily: "monospace" }}>
                    You bet {userSide?.toUpperCase()} — {userTotalBet.toFixed(4)} ETH
                  </div>
                  <div className="text-xs mt-1" style={{ color: "#444", fontFamily: "monospace" }}>
                    Better luck next round
                  </div>
                </div>
              )
            ) : !isConnected ? null : (
              /* SPECTATOR (connected but didn't bet) */
              <div className="text-center py-2">
                <div className="text-xs" style={{ color: "#444", fontFamily: "monospace" }}>You didn&apos;t bet this round</div>
              </div>
            )}
          </div>
        );
      })()}

      {/* BET button — hidden when market is resolved (claim section takes over) */}
      {market.status !== "resolved" && (
        <div className="px-4 py-3 shrink-0" style={{ borderBottom: "1px solid #1a1a1a" }}>
          <button
            onClick={handleBet}
            disabled={!isConnected ? false : (!canBet || isPlacing || isBetLoading)}
            className="w-full py-3.5 rounded font-black text-sm tracking-widest transition-all btn-primary"
            style={{
              fontFamily: "monospace",
              letterSpacing: "0.12em",
            }}
            aria-label={
              !isConnected
                ? "Connect Wallet"
                : `Place ${selectedSide ? selectedSide.toUpperCase() : ""} bet`
            }
          >
            {!isConnected ? (
              "CONNECT WALLET"
            ) : isPlacing || isBetLoading ? (
              <span className="flex items-center justify-center gap-2">
                <span
                  className="inline-block w-4 h-4 rounded-full border-2 border-black border-t-transparent"
                  style={{ animation: "spin 0.8s linear infinite" }}
                />
                CONFIRMING...
              </span>
            ) : !selectedSide ? (
              "SELECT SIDE"
            ) : !amountNum ? (
              "ENTER AMOUNT"
            ) : !isOpen ? (
              "BETTING CLOSED"
            ) : (
              `BET ${selectedSide.toUpperCase()} — ${amountNum.toFixed(3)} ETH`
            )}
          </button>

          {!isOpen && (
            <div
              className="text-center text-xs mt-2"
              style={{ color: "#555", fontFamily: "monospace" }}
            >
              Betting locked — awaiting oracle resolution
            </div>
          )}
        </div>
      )}

        </>
      )}

      {/* Recent bets */}
      <div className="px-4 py-3 flex flex-col gap-2 shrink-0" style={{ borderBottom: "1px solid #1a1a1a" }}>
        <div className="flex items-center justify-between">
          <span
            className="text-xs font-bold tracking-widest flex items-center gap-2"
            style={{ color: "#555", fontFamily: "monospace" }}
          >
            RECENT BETS
            {betsWithAge.length > 0 && (
              <span
                className="px-1.5 py-0.5 rounded text-xs font-black tabular"
                style={{
                  background: "rgba(0,255,136,0.1)",
                  border: "1px solid rgba(0,255,136,0.2)",
                  color: "#00ff88",
                  fontFamily: "monospace",
                  fontSize: 10,
                }}
              >
                {betsWithAge.length}
              </span>
            )}
          </span>
          <span
            className="text-xs flex items-center gap-1"
            style={{ color: "#333", fontFamily: "monospace" }}
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ background: "#00ff88" }}
            />
            ON-CHAIN
          </span>
        </div>
      </div>

      {/* Bets list */}
      <div
        ref={betsListRef}
        className="overflow-y-auto px-4 pb-2"
        style={{ maxHeight: 220, minHeight: 80 }}
      >
        {betsWithAge.length === 0 ? (
          <div
            className="text-center py-6 text-xs"
            style={{ color: "#333", fontFamily: "monospace" }}
          >
            No bets yet — be first
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {betsWithAge.map((bet) => {
              const isNew = bet.id === flashBetId;
              const sideColor = bet.side === "over" ? "#00ff88" : "#ff4444";
              return (
                <div
                  key={bet.id}
                  className={`flex items-center justify-between py-1.5 px-2 rounded transition-all group ${isNew ? "bet-flash" : ""}`}
                  style={{
                    background: isNew ? "rgba(0,255,136,0.06)" : "transparent",
                    animation: isNew ? "betFlash 0.8s ease-out" : undefined,
                    border: isNew ? "1px solid rgba(0,255,136,0.18)" : "1px solid transparent",
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="text-xs font-black tracking-wider"
                      style={{
                        color: sideColor,
                        fontFamily: "monospace",
                        minWidth: 36,
                      }}
                    >
                      {bet.side === "over" ? "\u25B2 OVR" : "\u25BC UND"}
                    </span>
                    <span
                      className="text-xs font-mono"
                      style={{ color: "#444" }}
                    >
                      {bet.shortWallet}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className="text-xs font-bold tabular"
                      style={{
                        color: sideColor,
                        fontFamily: "monospace",
                      }}
                    >
                      {bet.amount.toFixed(3)} ETH
                    </span>
                    <span
                      className="text-xs tabular"
                      style={{ color: "#333", fontFamily: "monospace", minWidth: 44, textAlign: "right" }}
                    >
                      {bet.timeAgo}
                    </span>
                    <a
                      href={`${explorerUrl}/tx/${bet.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label="View transaction on Basescan"
                    >
                      <ExternalLink size={10} style={{ color: "#444" }} />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer: pool stats */}
      <div
        className="flex items-center justify-between px-4 py-2 mt-auto shrink-0"
        style={{ borderTop: "1px solid #1a1a1a", background: "#0d0d0d" }}
      >
        <div>
          <div className="text-xs" style={{ color: "#444", fontFamily: "monospace" }}>
            POOL
          </div>
          <div
            className="text-sm font-black tabular"
            style={{
              color: market.totalPool > 0 ? "#00ff88" : "#444",
              fontFamily: "monospace",
              textShadow: market.totalPool > 0 ? "0 0 8px rgba(0,255,136,0.35)" : "none",
            }}
          >
            {market.totalPool > 0 ? `${market.totalPool.toFixed(3)} ETH` : "—"}
          </div>
        </div>
        <div className="text-right">
          <div className="flex items-center justify-end gap-1.5">
            {market.bettors > 0 && (
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{
                  background: "#00ff88",
                  boxShadow: "0 0 4px #00ff88",
                  animation: "pulse 1.5s ease-in-out infinite",
                }}
              />
            )}
            <div className="text-xs" style={{ color: "#444", fontFamily: "monospace" }}>
              {market.bettors > 0 ? "LIVE" : "BETTORS"}
            </div>
          </div>
          <div
            className="text-sm font-black tabular"
            style={{
              color: market.bettors > 0 ? "#00ff88" : "#444",
              fontFamily: "monospace",
            }}
          >
            {market.bettors > 0 ? market.bettors : "—"}
          </div>
        </div>
      </div>
    </div>
    <WalletModalComponent />
    </>
  );
}
