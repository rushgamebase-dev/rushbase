"use client";

import { useState, useEffect, useRef } from "react";

interface CountdownProps {
  lockTime?: number;
  timeLeft?: number;
  totalDuration?: number;
  status: "open" | "locked" | "resolving" | "resolved";
  roundNumber?: number;
}

export default function Countdown({
  lockTime,
  timeLeft: timeLeftProp,
  totalDuration = 300,
  status,
  roundNumber,
}: CountdownProps) {
  const [derivedTimeLeft, setDerivedTimeLeft] = useState<number>(() => {
    if (lockTime && lockTime > 0) {
      return Math.max(0, Math.floor(lockTime - Date.now() / 1000));
    }
    return timeLeftProp ?? 0;
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!lockTime || lockTime <= 0) {
      setDerivedTimeLeft(timeLeftProp ?? 0);
      return;
    }
    function tick() {
      setDerivedTimeLeft(Math.max(0, Math.floor(lockTime! - Date.now() / 1000)));
    }
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [lockTime, timeLeftProp]);

  const timeLeft = derivedTimeLeft;
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");

  const effectiveStatus =
    lockTime && lockTime > 0 && timeLeft <= 0 && status === "open"
      ? "locked"
      : status;

  const progress = totalDuration > 0 ? Math.max(0, timeLeft / totalDuration) : 0;
  const isUrgent = timeLeft <= 30 && effectiveStatus === "open";

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
    return (
      <div className="w-full py-4 text-center" style={{ background: "rgba(0,170,255,0.08)", border: "1px solid rgba(0,170,255,0.3)", borderRadius: 12 }}>
        <div className="flex items-center justify-center gap-2 mb-1">
          <span className="text-lg">✅</span>
          <span className="text-lg font-black tracking-widest" style={{ color: "#00aaff", fontFamily: "monospace" }}>
            ROUND COMPLETE
          </span>
        </div>
        <span className="text-xs" style={{ color: "#888" }}>Next round starting soon...</span>
      </div>
    );
  }

  // ── LOCKED (betting closed) ──
  if (effectiveStatus === "locked") {
    return (
      <div className="w-full py-4 text-center" style={{ background: "rgba(255,68,68,0.08)", border: "1px solid rgba(255,68,68,0.3)", borderRadius: 12 }}>
        <div className="flex items-center justify-center gap-2 mb-1">
          <span className="text-lg">🔒</span>
          <span className="text-lg font-black tracking-widest" style={{ color: "#ff4444", fontFamily: "monospace" }}>
            BETS ARE CLOSED
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
