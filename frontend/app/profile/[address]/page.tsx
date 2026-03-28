"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { ArrowLeft, Copy, Check, ExternalLink } from "lucide-react";
import Header from "@/components/Header";

interface ProfileBet {
  user: string;
  rangeIndex: number;
  rangeLabel: string;
  amount: string;
  txHash: string;
  timestamp: number;
  claimed: boolean;
  claimAmount: string | null;
  marketAddress: string;
  marketDescription: string;
  threshold: number;
  actualCount: number | null;
  marketState: string;
}

interface ProfileData {
  address: string;
  shortAddress: string;
  totalBets: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  tilesOwned: number;
  bets: ProfileBet[];
}

const EMPTY_PROFILE: ProfileData = {
  address: "",
  shortAddress: "",
  totalBets: 0,
  wins: 0,
  losses: 0,
  winRate: 0,
  totalPnl: 0,
  tilesOwned: 0,
  bets: [],
};

export default function ProfilePage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const [profile, setProfile] = useState<ProfileData>({ ...EMPTY_PROFILE, address, shortAddress: `${address.slice(0, 6)}...${address.slice(-4)}` });
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchProfile() {
      try {
        const res = await fetch(`/api/profile/${address}`);
        if (res.ok) {
          const data = await res.json();
          setProfile(data);
        }
      } catch {
        // Keep empty profile
      } finally {
        setLoading(false);
      }
    }
    fetchProfile();
  }, [address]);

  function copyAddress() {
    navigator.clipboard.writeText(address).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const statCards = [
    { label: "PREDICTIONS", value: profile.totalBets, color: "#e0e0e0" },
    { label: "WIN RATE", value: `${profile.winRate}%`, color: profile.winRate >= 50 ? "#00ff88" : "#ff4444" },
    {
      label: "TOTAL PNL",
      value: `${profile.totalPnl >= 0 ? "+" : ""}${profile.totalPnl.toFixed(4)} ETH`,
      color: profile.totalPnl >= 0 ? "#00ff88" : "#ff4444",
    },
    { label: "TILES OWNED", value: profile.tilesOwned, color: "#00aaff" },
  ];

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#0a0a0a", color: "#e0e0e0" }}>
      <Header />

      <main className="flex-1 p-4 md:p-8 max-w-4xl mx-auto w-full">

        {/* Back + title */}
        <div className="flex items-center gap-3 mb-6">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs transition-colors"
            style={{ color: "#555", fontFamily: "monospace" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "#00ff88")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "#555")}
          >
            <ArrowLeft size={13} />
            BACK
          </Link>
          <span style={{ color: "#333" }}>/</span>
          <span className="text-sm font-bold tracking-widest" style={{ color: "#e0e0e0", fontFamily: "monospace" }}>
            PROFILE
          </span>
        </div>

        {/* Address card */}
        <div
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-lg mb-6"
          style={{ background: "#111", border: "1px solid #1a1a1a" }}
        >
          <div>
            <div className="text-xs font-bold tracking-widest mb-1" style={{ color: "#555", fontFamily: "monospace" }}>
              ADDRESS
            </div>
            <div className="flex items-center gap-2">
              <span
                className="text-sm font-bold tabular"
                style={{ color: "#e0e0e0", fontFamily: "monospace" }}
              >
                {profile.shortAddress}
              </span>
              <button
                onClick={copyAddress}
                className="flex items-center justify-center w-6 h-6 rounded transition-colors"
                style={{ color: copied ? "#00ff88" : "#444", background: "none", border: "none" }}
                aria-label="Copy address"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
              <a
                href={`https://basescan.org/address/${address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center w-6 h-6"
                style={{ color: "#444" }}
                aria-label="View on Basescan"
              >
                <ExternalLink size={13} />
              </a>
            </div>
          </div>

          {/* Win/loss bar */}
          <div className="mt-3 sm:mt-0 flex flex-col items-end gap-1">
            <div className="flex gap-2 text-xs" style={{ fontFamily: "monospace" }}>
              <span style={{ color: "#00ff88" }}>{profile.wins}W</span>
              <span style={{ color: "#555" }}>/</span>
              <span style={{ color: "#ff4444" }}>{profile.losses}L</span>
            </div>
            <div className="flex h-2 w-32 rounded overflow-hidden" style={{ background: "#0d0d0d" }}>
              <div
                style={{
                  width: `${profile.winRate}%`,
                  background: "rgba(0,255,136,0.7)",
                  transition: "width 0.5s",
                }}
              />
            </div>
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {statCards.map((stat) => (
            <div
              key={stat.label}
              className="p-4 rounded"
              style={{ background: "#111", border: "1px solid #1a1a1a" }}
            >
              <div className="text-xs font-bold tracking-widest mb-1" style={{ color: "#555", fontFamily: "monospace" }}>
                {stat.label}
              </div>
              <div
                className="text-xl font-black tabular"
                style={{ color: stat.color, fontFamily: "monospace" }}
              >
                {stat.value}
              </div>
            </div>
          ))}
        </div>

        {/* Bet history table */}
        <div
          className="rounded-lg overflow-hidden"
          style={{ border: "1px solid #1a1a1a" }}
        >
          <div
            className="px-4 py-3"
            style={{ background: "#0d0d0d", borderBottom: "1px solid #1a1a1a" }}
          >
            <span
              className="text-xs font-bold tracking-widest"
              style={{ color: "#555", fontFamily: "monospace" }}
            >
              BET HISTORY
            </span>
          </div>

          {/* Table header */}
          <div
            className="hidden md:grid px-4 py-2 text-xs"
            style={{
              gridTemplateColumns: "1fr 60px 80px 80px 90px 40px",
              color: "#444",
              fontFamily: "monospace",
              borderBottom: "1px solid #1a1a1a",
              background: "#0d0d0d",
            }}
          >
            <span>MARKET</span>
            <span>SIDE</span>
            <span>AMOUNT</span>
            <span>RESULT</span>
            <span className="text-right">PNL</span>
            <span className="text-right">TX</span>
          </div>

          {loading && (
            <div
              className="px-4 py-8 text-center text-xs"
              style={{ color: "#555", fontFamily: "monospace", background: "#111" }}
            >
              Loading...
            </div>
          )}

          {!loading && profile.bets.length === 0 && (
            <div
              className="px-4 py-8 text-center text-xs"
              style={{ color: "#444", fontFamily: "monospace", background: "#111" }}
            >
              No predictions yet
            </div>
          )}
          {profile.bets.map((bet: ProfileBet, i: number) => {
            const amount = parseFloat(bet.amount) || 0;
            const isOver = bet.rangeIndex === 1;
            const isResolved = bet.marketState === "resolved";
            const won = bet.claimed && !!bet.claimAmount;
            const lost = isResolved && !won;
            const claimAmt = parseFloat(bet.claimAmount || "0");
            const pnl = won ? claimAmt - amount : lost ? -amount : 0;
            const result = won ? "win" : lost ? "loss" : "pending";

            return (
              <div
                key={`${bet.txHash}-${i}`}
                className="grid px-4 py-3 text-xs items-center"
                style={{
                  gridTemplateColumns: "1fr 60px 80px 80px 90px 40px",
                  background: i % 2 === 0 ? "#111" : "#0e0e0e",
                  borderBottom: i < profile.bets.length - 1 ? "1px solid #1a1a1a" : "none",
                  color: "#666",
                  fontFamily: "monospace",
                }}
              >
                <span style={{ color: "#aaa" }}>{bet.marketDescription || bet.marketAddress?.slice(0, 10)}</span>
                <span
                  className="font-bold"
                  style={{ color: isOver ? "#00ff88" : "#ff4444" }}
                >
                  {isOver ? "▲ OVER" : "▼ UNDER"}
                </span>
                <span style={{ color: "#888" }}>{amount.toFixed(3)} ETH</span>
                <span
                  className="font-bold"
                  style={{
                    color:
                      result === "win"
                        ? "#00ff88"
                        : result === "loss"
                        ? "#ff4444"
                        : "#888",
                  }}
                >
                  {result.toUpperCase()}
                </span>
                <span
                  className="text-right font-bold"
                  style={{
                    color: pnl > 0 ? "#00ff88" : pnl < 0 ? "#ff4444" : "#888",
                  }}
                >
                  {pnl > 0 ? "+" : ""}{pnl.toFixed(4)}
                </span>
                <div className="flex justify-end">
                  <a
                    href={`https://basescan.org/tx/${bet.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#333" }}
                    className="hover:text-[#00ff88] transition-colors"
                    aria-label="View on Basescan"
                  >
                    <ExternalLink size={11} />
                  </a>
                </div>
              </div>
            );
          })}
        </div>

        {/* Tiles link */}
        {profile.tilesOwned > 0 && (
          <div className="mt-4 text-xs" style={{ color: "#444", fontFamily: "monospace" }}>
            <Link href="/tiles" className="hover:text-[#00aaff] transition-colors">
              View tiles ({profile.tilesOwned} owned) →
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
