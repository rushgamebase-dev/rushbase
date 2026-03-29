"use client";

import { useState, useEffect, useRef } from "react";

interface CountdownProps {
  lockTime?: number;
  timeLeft?: number;
  totalDuration?: number;
  status: "open" | "locked" | "resolving" | "resolved" | "cancelled";
  roundNumber?: number;
  /** Final vehicle count — shown in the resolved reveal */
  finalCount?: number;
  /** Index of winning range: 1 = OVER, 0 = UNDER. -1 = unknown */
  winningRangeIndex?: number;
  /** Live vehicle count from oracle (shown during counting phase) */
  liveCount?: number;
  /** Threshold for OVER/UNDER */
  threshold?: number;
}

export default function Countdown({
  lockTime,
  timeLeft: timeLeftProp,
  totalDuration = 300,
  status,
  roundNumber,
  liveCount = 0,
  threshold = 0,
  finalCount,
  winningRangeIndex = -1,
}: CountdownProps) {
  // Clock offset: server time minus client time (ms). Corrects device clock skew.
  const clockOffsetRef = useRef(0);

  useEffect(() => {
    async function syncClock() {
      try {
        const before = Date.now();
        const res = await fetch("/api/health");
        const after = Date.now();
        const data = await res.json();
        if (data.serverTime) {
          const rtt = after - before;
          clockOffsetRef.current = data.serverTime + rtt / 2 - after;
        }
      } catch { /* use raw client clock */ }
    }
    syncClock();
  }, []);

  // Corrected "now" accounting for clock skew
  function correctedNow() {
    return Date.now() + clockOffsetRef.current;
  }

  const COUNTING_DURATION = 150; // seconds of counting after bets close

  const [derivedTimeLeft, setDerivedTimeLeft] = useState<number>(() => {
    if (lockTime && lockTime > 0) {
      return Math.max(0, Math.floor(lockTime - Date.now() / 1000));
    }
    return timeLeftProp ?? 0;
  });

  // Counting phase countdown (lockTime + 150s = round end)
  const [countingTimeLeft, setCountingTimeLeft] = useState(0);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!lockTime || lockTime <= 0) {
      setDerivedTimeLeft(timeLeftProp ?? 0);
      return;
    }
    function tick() {
      setDerivedTimeLeft(Math.max(0, Math.floor(lockTime! - correctedNow() / 1000)));
    }
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [lockTime, timeLeftProp]);

  // Counting phase timer — ticks every second after betting closes
  useEffect(() => {
    if (!lockTime || lockTime <= 0) return;
    const roundEnd = lockTime + COUNTING_DURATION;
    function countingTick() {
      setCountingTimeLeft(Math.max(0, Math.floor(roundEnd - correctedNow() / 1000)));
    }
    countingTick();
    countingIntervalRef.current = setInterval(countingTick, 1000);
    return () => { if (countingIntervalRef.current) clearInterval(countingIntervalRef.current); };
  }, [lockTime]);

  const timeLeft = derivedTimeLeft;
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");

  // No heuristic — trust contract state only. Frontend disables bet buttons
  // via lockTime comparison, but doesn't fake state transitions.
  const effectiveStatus = status;

  const progress = totalDuration > 0 ? Math.max(0, timeLeft / totalDuration) : 0;
  const isUrgent = timeLeft <= 30 && effectiveStatus === "open";

  // ── BETTING CLOSED, COUNTING IN PROGRESS ──
  // lockTime passed but contract is still OPEN (oracle hasn't resolved yet).
  // Show live vehicle count vs threshold — the thing everyone is watching.
  if (effectiveStatus === "open" && timeLeft <= 0) {
    const isOver = liveCount > threshold;
    const countColor = isOver ? "#00ff88" : "#ff4444";
    const diff = isOver ? liveCount - threshold : threshold - liveCount;

    const cMm = String(Math.floor(countingTimeLeft / 60)).padStart(2, "0");
    const cSs = String(countingTimeLeft % 60).padStart(2, "0");

    return (
      <div className="w-full py-4 text-center" style={{ background: "rgba(0,0,0,0.6)", border: `1px solid ${countColor}44`, borderRadius: 12 }}>
        <div className="flex items-center justify-between px-4 mb-2">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ background: countColor, animation: "pulse 0.8s ease-in-out infinite", boxShadow: `0 0 12px ${countColor}` }} />
            <span className="text-xs font-black tracking-widest" style={{ color: "#888", fontFamily: "monospace" }}>
              COUNTING
            </span>
          </div>
          <span
            className="text-sm font-black tabular-nums"
            style={{ color: "#ffaa00", fontFamily: "monospace" }}
          >
            {cMm}:{cSs}
          </span>
        </div>
        <div
          className="font-black tabular-nums"
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            fontSize: 48,
            color: countColor,
            textShadow: `0 0 24px ${countColor}66`,
            lineHeight: 1,
          }}
        >
          {String(liveCount).padStart(3, "0")}
        </div>
        {threshold > 0 && (
          <div className="text-xs mt-2" style={{ color: "#888", fontFamily: "monospace" }}>
            threshold: <span style={{ color: "#ffd700" }}>{threshold}</span>
            {" · "}
            <span style={{ color: countColor, fontWeight: 700 }}>
              {isOver ? `+${diff} over` : `${diff} to go`}
            </span>
          </div>
        )}
      </div>
    );
  }

  // ── CANCELLED (no bets / one-sided) ──
  if (effectiveStatus === "cancelled") {
    return (
      <div className="w-full py-4 text-center" style={{ background: "rgba(100,100,100,0.08)", border: "1px solid rgba(100,100,100,0.3)", borderRadius: 12 }}>
        <span className="text-lg font-black tracking-widest" style={{ color: "#888", fontFamily: "monospace" }}>
          ROUND CANCELLED
        </span>
        <div className="text-xs mt-1" style={{ color: "#555" }}>No bets placed — next round starting soon</div>
      </div>
    );
  }

  // ── RESOLVING ──
  if (effectiveStatus === "resolving") {
    return (
      <div className="w-full py-4 text-center" style={{ background: "rgba(255,170,0,0.08)", border: "1px solid rgba(255,170,0,0.3)", borderRadius: 12 }}>
        <div className="flex items-center justify-center gap-2 mb-1">
          <div className="w-3 h-3 rounded-full" style={{ background: "#ffaa00", animation: "pulse 0.8s ease-in-out infinite", boxShadow: "0 0 12px rgba(255,170,0,0.8)" }} />
          <span className="text-lg font-black tracking-widest" style={{ color: "#ffaa00", fontFamily: "monospace" }}>
            RESOLVING...
          </span>
        </div>
        <span className="text-xs" style={{ color: "#888" }}>Counting final vehicles</span>
      </div>
    );
  }

  // ── RESOLVED ──
  if (effectiveStatus === "resolved") {
    const winningSide = winningRangeIndex === 1 ? "over" : winningRangeIndex === 0 ? "under" : null;
    const winColor = winningSide === "over" ? "#00ff88" : winningSide === "under" ? "#ff4444" : "#00aaff";
    const winLabel = winningSide === "over" ? "OVER WINS" : winningSide === "under" ? "UNDER WINS" : "ROUND COMPLETE";

    return (
      <div
        className="result-reveal-flash w-full py-4 text-center"
        style={{
          border: `1px solid ${winColor}55`,
          borderRadius: 12,
        }}
      >
        {/* Final count — large pop-in */}
        {finalCount !== undefined && finalCount > 0 && (
          <div className="result-count-pop mb-1">
            <div
              className="text-xs font-bold tracking-widest mb-1"
              style={{ color: "#555", fontFamily: "monospace" }}
            >
              FINAL COUNT
            </div>
            <div
              className="font-black tabular-nums"
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, monospace",
                fontSize: 40,
                color: winColor,
                textShadow: `0 0 24px ${winColor}99, 0 0 48px ${winColor}44`,
                lineHeight: 1,
              }}
            >
              {String(finalCount).padStart(3, "0")}
            </div>
          </div>
        )}

        {/* Winning side label */}
        <div
          className="font-black tracking-widest"
          style={{
            fontFamily: "monospace",
            fontSize: 18,
            color: winColor,
            textShadow: `0 0 16px ${winColor}88`,
            letterSpacing: "0.14em",
          }}
        >
          {winLabel}
        </div>
        <div className="text-xs mt-1.5" style={{ color: "#555", fontFamily: "monospace" }}>
          Next round starting soon...
        </div>
      </div>
    );
  }

  // ── LOCKED (betting closed) ──
  if (effectiveStatus === "locked") {
    return (
      <div className="w-full py-4 text-center" style={{ background: "rgba(255,68,68,0.08)", border: "1px solid rgba(255,68,68,0.3)", borderRadius: 12 }}>
        <div className="flex items-center justify-center gap-2 mb-1">
          <span className="text-lg font-black tracking-widest" style={{ color: "#ff4444", fontFamily: "monospace" }}>
            BETS CLOSED
          </span>
        </div>
        <span className="text-xs" style={{ color: "#888" }}>Watching the count...</span>
      </div>
    );
  }

  // ── OPEN (betting active) ──
  return (
    <div className="w-full" style={{ background: "rgba(0,255,136,0.04)", border: "1px solid rgba(0,255,136,0.2)", borderRadius: 12, padding: "12px 16px" }}>
      {/* Status label */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: "#00ff88" }} />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: "#00ff88" }} />
          </div>
          <span className="text-sm font-black tracking-widest" style={{ color: "#00ff88", fontFamily: "monospace" }}>
            BETS OPEN
          </span>
        </div>
        {roundNumber !== undefined && (
          <span className="text-xs" style={{ color: "#555", fontFamily: "monospace" }}>
            ROUND #{roundNumber}
          </span>
        )}
      </div>

      {/* Big message */}
      <div className="text-center mb-3">
        <span className="text-xs font-bold tracking-wider" style={{ color: "#888" }}>
          BETS CLOSE IN
        </span>
      </div>

      {/* Giant timer */}
      <div className="text-center mb-3">
        <span
          className="font-black tabular-nums"
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            fontSize: isUrgent ? 48 : 42,
            color: isUrgent ? "#ff4444" : "#00ff88",
            textShadow: isUrgent
              ? "0 0 20px rgba(255,68,68,0.6), 0 0 40px rgba(255,68,68,0.3)"
              : "0 0 20px rgba(0,255,136,0.4), 0 0 40px rgba(0,255,136,0.2)",
            animation: isUrgent ? "pulse 0.8s ease-in-out infinite" : "none",
            letterSpacing: "0.08em",
          }}
        >
          {mm}:{ss}
        </span>
      </div>

      {/* Urgent warning */}
      {isUrgent && (
        <div className="text-center mb-2">
          <span className="text-xs font-bold tracking-wider" style={{ color: "#ff4444", animation: "pulse 1s ease-in-out infinite" }}>
            ⚡ HURRY — CLOSING SOON! ⚡
          </span>
        </div>
      )}

      {/* Progress bar */}
      <div className="relative h-2 rounded-full overflow-hidden" style={{ background: "#1a1a1a" }}>
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-all duration-1000"
          style={{
            width: `${(1 - progress) * 100}%`,
            background: isUrgent
              ? "linear-gradient(90deg, #ff4444, #ff8888)"
              : "linear-gradient(90deg, #00ff88, #00cc70)",
            boxShadow: isUrgent
              ? "0 0 8px rgba(255,68,68,0.6)"
              : "0 0 8px rgba(0,255,136,0.5)",
          }}
        />
      </div>
    </div>
  );
}
