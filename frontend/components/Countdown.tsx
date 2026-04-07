"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface CountdownProps {
  lockTime?: number;
  timeLeft?: number;
  totalDuration?: number;
  status: "open" | "locked" | "resolving" | "resolved" | "cancelled";
  roundNumber?: number;
  finalCount?: number;
  winningRangeIndex?: number;
  liveCount?: number;
  threshold?: number;
  /** Oracle-authoritative phase — overrides local clock derivation */
  oraclePhase?: "idle" | "betting" | "counting" | "final";
  /** Oracle-authoritative remaining seconds — overrides lockTime math */
  oracleRemaining?: number;
}

export default function Countdown({
  lockTime,
  timeLeft: timeLeftProp,
  totalDuration = 300,
  status,
  liveCount = 0,
  threshold = 0,
  finalCount,
  winningRangeIndex = -1,
  oraclePhase,
  oracleRemaining,
}: CountdownProps) {
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
    const resyncInterval = setInterval(syncClock, 60_000);
    return () => clearInterval(resyncInterval);
  }, []);

  function correctedNow() {
    return Date.now() + clockOffsetRef.current;
  }

  const COUNTING_DURATION = 150;
  const INTER_ROUND_SECS = 15;

  const [nextRoundCountdown, setNextRoundCountdown] = useState(0);
  const nextRoundRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevStatusRef = useRef(status);

  useEffect(() => {
    if ((status === "resolved" || status === "cancelled") && prevStatusRef.current !== status) {
      setNextRoundCountdown(INTER_ROUND_SECS);
      nextRoundRef.current = setInterval(() => {
        setNextRoundCountdown(prev => {
          if (prev <= 1) {
            if (nextRoundRef.current) clearInterval(nextRoundRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    prevStatusRef.current = status;
    return () => { if (nextRoundRef.current) clearInterval(nextRoundRef.current); };
  }, [status]);

  const [derivedTimeLeft, setDerivedTimeLeft] = useState<number>(0);
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
  const effectiveStatus = status;
  const progress = totalDuration > 0 ? Math.max(0, timeLeft / totalDuration) : 0;
  const isUrgent = timeLeft <= 30 && timeLeft > 0 && effectiveStatus === "open" && oraclePhase === "betting";

  // ── COUNTING (betting closed, watching vehicles) ──
  // Use oracle phase as authority; fallback to lockTime math
  const isCounting = oraclePhase ? oraclePhase === "counting" : (effectiveStatus === "open" && timeLeft <= 0);
  // Use oracle remaining when available; fallback to lockTime-derived timer
  const countingDisplay = oracleRemaining !== undefined ? Math.ceil(oracleRemaining) : countingTimeLeft;

  if (isCounting) {
    const isOver = liveCount > threshold;
    const countColor = isOver ? "#00ff88" : "#ff4444";
    const diff = isOver ? liveCount - threshold : threshold - liveCount;
    const cMm = String(Math.floor(countingDisplay / 60)).padStart(2, "0");
    const cSs = String(countingDisplay % 60).padStart(2, "0");

    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full px-3 py-2 flex items-center justify-between"
        style={{
          background: "rgba(0,0,0,0.85)",
          border: `1px solid ${countColor}55`,
          borderRadius: 10,
          boxShadow: `0 0 30px ${countColor}22, inset 0 0 20px ${countColor}08`,
        }}
      >
        <div className="flex items-center gap-2">
          <img src="/mascot/confident.gif" alt="" style={{ width: 28, height: 28, borderRadius: "50%" }} />
          <div className="w-2 h-2 rounded-full" style={{ background: countColor, animation: "pulse 0.8s ease-in-out infinite", boxShadow: `0 0 8px ${countColor}` }} />
          <span className="text-xs font-black tracking-wider" style={{ color: "#aaa", fontFamily: "monospace" }}>COUNTING</span>
        </div>
        <div className="flex items-center gap-3">
          <motion.span
            key={liveCount}
            initial={{ scale: 1.4, color: "#ffffff" }}
            animate={{ scale: 1, color: countColor }}
            transition={{ duration: 0.3 }}
            className="font-black tabular-nums text-xl md:text-3xl"
            style={{ fontFamily: "monospace", lineHeight: 1 }}
          >
            {String(liveCount).padStart(3, "0")}
          </motion.span>
          {threshold > 0 && (
            <span className="text-xs" style={{ color: "#888", fontFamily: "monospace" }}>
              /{threshold} <span style={{ color: countColor, fontWeight: 700 }}>{isOver ? `+${diff}` : `-${diff}`}</span>
            </span>
          )}
          <span className="text-xs font-black tabular-nums" style={{ color: "#ffaa00", fontFamily: "monospace", textShadow: "0 0 6px rgba(255,170,0,0.5)" }}>
            {cMm}:{cSs}
          </span>
        </div>
      </motion.div>
    );
  }

  // ── CANCELLED ──
  if (effectiveStatus === "cancelled") {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="w-full px-3 py-2 flex items-center justify-between"
        style={{ background: "rgba(0,0,0,0.85)", border: "1px solid #33333366", borderRadius: 10 }}
      >
        <div className="flex items-center gap-2">
          <img src="/mascot/chill.gif" alt="" style={{ width: 28, height: 28, borderRadius: "50%" }} />
          <span className="text-xs font-black" style={{ color: "#888", fontFamily: "monospace" }}>ROUND CANCELLED</span>
        </div>
        <span className="text-xs font-black" style={{ color: "#00ff88", fontFamily: "monospace" }}>
          {nextRoundCountdown > 0 ? `Next in ${nextRoundCountdown}s` : "Starting..."}
        </span>
      </motion.div>
    );
  }

  // ── RESOLVING ──
  if (effectiveStatus === "resolving") {
    return (
      <motion.div
        animate={{ borderColor: ["rgba(255,170,0,0.3)", "rgba(255,170,0,0.7)", "rgba(255,170,0,0.3)"] }}
        transition={{ duration: 2, repeat: Infinity }}
        className="w-full py-3 text-center"
        style={{ background: "rgba(255,170,0,0.08)", borderWidth: 1, borderStyle: "solid", borderRadius: 12 }}
      >
        <div className="flex items-center justify-center gap-3">
          <img src="/mascot/confident.gif" alt="" style={{ width: 40, height: 40, borderRadius: "50%" }} />
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <motion.div
                animate={{ scale: [1, 1.3, 1] }}
                transition={{ duration: 0.8, repeat: Infinity }}
                className="w-3 h-3 rounded-full"
                style={{ background: "#ffaa00", boxShadow: "0 0 12px rgba(255,170,0,0.8)" }}
              />
              <span className="text-lg font-black tracking-widest" style={{ color: "#ffaa00", fontFamily: "monospace", textShadow: "0 0 10px rgba(255,170,0,0.5)" }}>
                RESOLVING...
              </span>
            </div>
            <span className="text-xs" style={{ color: "#888" }}>Final count incoming</span>
          </div>
        </div>
      </motion.div>
    );
  }

  // ── RESOLVED ──
  if (effectiveStatus === "resolved") {
    const winningSide = winningRangeIndex === 1 ? "over" : winningRangeIndex === 0 ? "under" : null;
    const winColor = winningSide === "over" ? "#00ff88" : winningSide === "under" ? "#ff4444" : "#00aaff";
    const winLabel = winningSide === "over" ? "OVER WINS!" : winningSide === "under" ? "UNDER WINS!" : "ROUND COMPLETE";
    const mascotGif = winningSide ? "/mascot/victory.gif" : "/mascot/payout.gif";

    return (
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full px-3 py-3"
        style={{
          background: `linear-gradient(135deg, rgba(0,0,0,0.9), ${winColor}15)`,
          border: `2px solid ${winColor}66`,
          borderRadius: 12,
          boxShadow: `0 0 40px ${winColor}25`,
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <motion.img
              src={mascotGif}
              alt=""
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 200, delay: 0.2 }}
              style={{ width: 48, height: 48, borderRadius: "50%", border: `2px solid ${winColor}55` }}
            />
            <div>
              {finalCount !== undefined && finalCount > 0 && (
                <motion.span
                  initial={{ scale: 2, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 150 }}
                  className="font-black tabular-nums block"
                  style={{ fontFamily: "monospace", fontSize: 32, color: winColor, lineHeight: 1, textShadow: `0 0 20px ${winColor}66` }}
                >
                  {String(finalCount).padStart(3, "0")}
                </motion.span>
              )}
              <motion.span
                initial={{ x: -20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="text-sm font-black tracking-wider"
                style={{ color: winColor, fontFamily: "monospace" }}
              >
                {winLabel}
              </motion.span>
            </div>
          </div>
          <div className="text-right">
            <span className="text-xs font-black block" style={{ color: "#00ff88", fontFamily: "monospace" }}>
              {nextRoundCountdown > 0 ? `Next in ${nextRoundCountdown}s` : "Starting..."}
            </span>
            <img src="/mascot/payout.gif" alt="" style={{ width: 28, height: 28, borderRadius: "50%", marginTop: 4 }} />
          </div>
        </div>
      </motion.div>
    );
  }

  // ── LOCKED ──
  if (effectiveStatus === "locked") {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="w-full px-3 py-2 flex items-center justify-center gap-3"
        style={{ background: "rgba(255,68,68,0.08)", border: "1px solid rgba(255,68,68,0.3)", borderRadius: 10 }}
      >
        <img src="/mascot/confident.gif" alt="" style={{ width: 28, height: 28, borderRadius: "50%" }} />
        <span className="text-xs font-black tracking-widest" style={{ color: "#ff4444", fontFamily: "monospace" }}>BETS CLOSED</span>
        <span className="text-xs" style={{ color: "#888", fontFamily: "monospace" }}>Watching the count...</span>
      </motion.div>
    );
  }

  // ── OPEN (betting active) ──
  const timerColor = isUrgent ? "#ff4444" : "#00ff88";
  const mascotSrc = isUrgent ? "/mascot/hurry.gif" : "/mascot/chill.gif";

  return (
    <motion.div
      className="w-full px-3 py-2"
      animate={isUrgent ? {
        borderColor: ["rgba(255,68,68,0.3)", "rgba(255,68,68,0.8)", "rgba(255,68,68,0.3)"],
        boxShadow: ["0 0 0px rgba(255,68,68,0)", "0 0 25px rgba(255,68,68,0.3)", "0 0 0px rgba(255,68,68,0)"],
      } : {}}
      transition={isUrgent ? { duration: 1, repeat: Infinity } : {}}
      style={{
        background: isUrgent ? "rgba(255,68,68,0.08)" : "rgba(0,0,0,0.85)",
        border: `1px solid ${timerColor}44`,
        borderRadius: 10,
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AnimatePresence mode="wait">
            <motion.img
              key={isUrgent ? "hurry" : "chill"}
              src={mascotSrc}
              alt=""
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              style={{ width: 28, height: 28, borderRadius: "50%" }}
            />
          </AnimatePresence>
          <div className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: timerColor }} />
            <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: timerColor }} />
          </div>
          <span className="text-xs font-black tracking-wider" style={{ color: timerColor, fontFamily: "monospace" }}>
            {isUrgent ? "LAST CHANCE!" : "BETS OPEN"}
          </span>
        </div>
        <motion.span
          className="font-black tabular-nums text-lg md:text-2xl"
          animate={isUrgent ? { scale: [1, 1.1, 1] } : {}}
          transition={isUrgent ? { duration: 0.5, repeat: Infinity } : {}}
          style={{
            fontFamily: "monospace",
            color: timerColor,
            textShadow: isUrgent ? `0 0 15px ${timerColor}88` : "none",
          }}
        >
          {mm}:{ss}
        </motion.span>
      </div>
      {/* Progress bar */}
      <div className="relative h-1 rounded-full overflow-hidden mt-1.5" style={{ background: "#1a1a1a" }}>
        <motion.div
          className="absolute left-0 top-0 h-full rounded-full"
          style={{ width: `${(1 - progress) * 100}%`, background: timerColor }}
          layout
          transition={{ duration: 1 }}
        />
      </div>
    </motion.div>
  );
}
