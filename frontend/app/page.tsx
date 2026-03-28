"use client";

import { useLiveMarket } from "@/lib/mock";
import { useActiveMarket } from "@/hooks/useActiveMarket";
import Header from "@/components/Header";
import VideoPlayer from "@/components/VideoPlayer";
import BettingPanel from "@/components/BettingPanel";
import Chat from "@/components/Chat";
import Countdown from "@/components/Countdown";
import RoundHistory from "@/components/RoundHistory";
import StatsBar from "@/components/StatsBar";

export default function Home() {
  const market = useLiveMarket();
  const { marketAddress, isDemoMode } = useActiveMarket();

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#0a0a0a", color: "#e0e0e0" }}>
      <Header viewerCount={247} />
      <StatsBar />

      {/* Main 3-column layout */}
      <div className="flex-1 flex min-h-0 flex-col lg:flex-row">

        {/* Left: Video + stats (55%) */}
        <div
          className="flex flex-col p-3 gap-3 overflow-y-auto lg:overflow-visible"
          style={{
            flex: "0 0 55%",
            maxWidth: "100%",
            borderRight: "1px solid #1a1a1a",
          }}
        >
          <VideoPlayer
            vehicleCount={market.vehicleCount}
            isLive={market.status === "open" || market.status === "locked"}
          />

          {/* Countdown + count row */}
          <div
            className="grid grid-cols-2 gap-4 p-4 rounded"
            style={{ background: "#111", border: "1px solid #1a1a1a" }}
          >
            <Countdown
              timeLeft={market.timeLeft}
              totalDuration={market.totalDuration}
              status={market.status}
            />
            <div className="flex flex-col justify-center gap-1">
              <div
                className="text-xs font-bold tracking-widest"
                style={{ color: "#555", fontFamily: "monospace" }}
              >
                CURRENT COUNT
              </div>
              <div
                className="text-3xl font-black tabular"
                style={{
                  color: "#00ff88",
                  fontFamily: "monospace",
                  textShadow: "0 0 16px rgba(0,255,136,0.4)",
                }}
              >
                {String(market.vehicleCount).padStart(3, "0")}
              </div>
              <div className="text-xs" style={{ color: "#555", fontFamily: "monospace" }}>
                threshold:{" "}
                <span style={{ color: "#ffd700" }}>{market.threshold}</span>
                {" · "}
                <span
                  style={{
                    color: market.vehicleCount > market.threshold ? "#00ff88" : "#ff4444",
                    fontWeight: 700,
                  }}
                >
                  {market.vehicleCount > market.threshold
                    ? `+${market.vehicleCount - market.threshold} over`
                    : `${market.threshold - market.vehicleCount} to go`}
                </span>
              </div>
            </div>
          </div>

          {/* Pool bars */}
          <div
            className="p-4 rounded"
            style={{ background: "#111", border: "1px solid #1a1a1a" }}
          >
            <div
              className="text-xs font-bold tracking-widest mb-3"
              style={{ color: "#555", fontFamily: "monospace" }}
            >
              POOL DISTRIBUTION
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold w-16 shrink-0" style={{ color: "#00ff88", fontFamily: "monospace" }}>
                  &#9650; OVER
                </span>
                <div className="flex-1 h-4 rounded overflow-hidden" style={{ background: "#0d0d0d" }}>
                  <div
                    className="h-full rounded transition-all duration-700"
                    style={{ width: `${market.overPct}%`, background: "rgba(0,255,136,0.7)" }}
                  />
                </div>
                <span className="text-xs font-bold tabular w-24 text-right shrink-0" style={{ color: "#00ff88", fontFamily: "monospace" }}>
                  {market.overPool.toFixed(3)} ETH
                </span>
                <span className="text-xs tabular w-8 text-right shrink-0" style={{ color: "#444", fontFamily: "monospace" }}>
                  {market.overPct}%
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold w-16 shrink-0" style={{ color: "#ff4444", fontFamily: "monospace" }}>
                  &#9660; UNDER
                </span>
                <div className="flex-1 h-4 rounded overflow-hidden" style={{ background: "#0d0d0d" }}>
                  <div
                    className="h-full rounded transition-all duration-700"
                    style={{ width: `${market.underPct}%`, background: "rgba(255,68,68,0.7)" }}
                  />
                </div>
                <span className="text-xs font-bold tabular w-24 text-right shrink-0" style={{ color: "#ff4444", fontFamily: "monospace" }}>
                  {market.underPool.toFixed(3)} ETH
                </span>
                <span className="text-xs tabular w-8 text-right shrink-0" style={{ color: "#444", fontFamily: "monospace" }}>
                  {market.underPct}%
                </span>
              </div>
            </div>
          </div>

          {/* Round history */}
          <div
            className="p-4 rounded"
            style={{ background: "#111", border: "1px solid #1a1a1a" }}
          >
            <RoundHistory history={market.roundHistory} />
          </div>

          {/* Footer links */}
          <div className="flex gap-4 text-xs pb-2" style={{ color: "#333", fontFamily: "monospace" }}>
            <a href="/tiles" className="hover:text-[#00ff88] transition-colors">Tiles</a>
            <a href="/stats" className="hover:text-[#00ff88] transition-colors">Stats</a>
            <a href="https://basescan.org" target="_blank" rel="noopener noreferrer" className="hover:text-[#00ff88] transition-colors">
              Basescan
            </a>
            {isDemoMode && (
              <span style={{ color: "#ffaa00" }}>DEMO MODE</span>
            )}
          </div>
        </div>

        {/* Center: Betting panel (25%) */}
        <div
          className="flex flex-col"
          style={{ flex: "0 0 25%", maxWidth: "100%", minWidth: 0 }}
        >
          <BettingPanel market={market} marketAddress={marketAddress} />
        </div>

        {/* Right: Chat (20%) — hidden on mobile (floating button instead) */}
        <div
          className="hidden lg:flex flex-col"
          style={{
            flex: "0 0 20%",
            maxWidth: "20%",
            borderLeft: "1px solid #1a1a1a",
          }}
        >
          <Chat />
        </div>
      </div>

      {/* Mobile chat floating button */}
      <div className="lg:hidden">
        <Chat />
      </div>
    </div>
  );
}
