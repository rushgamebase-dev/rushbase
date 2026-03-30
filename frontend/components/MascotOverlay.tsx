"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface MascotOverlayProps {
  status: "open" | "locked" | "resolving" | "resolved" | "cancelled";
  winningRangeIndex?: number;
  finalCount?: number;
  threshold?: number;
  timeLeft?: number;
  isCounting?: boolean;
}

interface Card {
  id: string;
  mascot: string;
  title: string;
  subtitle?: string;
  color: string;
  duration: number; // ms before auto-hide
  confetti?: boolean;
  size?: "normal" | "big";
}

export default function MascotOverlay({
  status,
  winningRangeIndex = -1,
  finalCount,
  threshold = 0,
  timeLeft = 999,
  isCounting = false,
}: MascotOverlayProps) {
  const [card, setCard] = useState<Card | null>(null);
  const prevStatusRef = useRef(status);
  const prevCountingRef = useRef(isCounting);
  const prevUrgentRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Show card with auto-dismiss
  function showCard(c: Card) {
    if (timerRef.current) clearTimeout(timerRef.current);
    setCard(c);
    timerRef.current = setTimeout(() => setCard(null), c.duration);
  }

  // Play a brief pleasant sound
  function playSound(freq: number, duration: number, type: OscillatorType = "sine") {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration);
    } catch { /* AudioContext unavailable */ }
  }

  function playWinSound() {
    playSound(523, 0.15); // C5
    setTimeout(() => playSound(659, 0.15), 100); // E5
    setTimeout(() => playSound(784, 0.3), 200); // G5
  }

  function playStartSound() {
    playSound(440, 0.1); // A4
    setTimeout(() => playSound(554, 0.15), 80); // C#5
  }

  function playUrgentSound() {
    playSound(880, 0.08, "square");
    setTimeout(() => playSound(880, 0.08, "square"), 120);
  }

  // ── State transition detection ──
  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    const prevCounting = prevCountingRef.current;
    const isUrgent = timeLeft <= 30 && status === "open" && !isCounting;
    const wasUrgent = prevUrgentRef.current;

    // BETS OPEN (new round started)
    if (status === "open" && prevStatus !== "open" && !isCounting) {
      playStartSound();
      showCard({
        id: "open-" + Date.now(),
        mascot: "/mascot/chill.gif",
        title: "BETS ARE OPEN!",
        subtitle: "Place your prediction now",
        color: "#00ff88",
        duration: 3000,
      });
    }

    // LAST CHANCE (30s left)
    if (isUrgent && !wasUrgent) {
      playUrgentSound();
      showCard({
        id: "urgent-" + Date.now(),
        mascot: "/mascot/hurry.gif",
        title: "LAST CHANCE!",
        subtitle: `${timeLeft}s left to bet`,
        color: "#ff4444",
        duration: 4000,
      });
    }

    // COUNTING STARTED
    if (isCounting && !prevCounting) {
      playStartSound();
      showCard({
        id: "counting-" + Date.now(),
        mascot: "/mascot/confident.gif",
        title: "COUNTING STARTED!",
        subtitle: "Watching the road...",
        color: "#ffaa00",
        duration: 2500,
      });
    }

    // RESOLVED
    if (status === "resolved" && prevStatus !== "resolved") {
      const winningSide = winningRangeIndex === 1 ? "over" : winningRangeIndex === 0 ? "under" : null;
      const winColor = winningSide === "over" ? "#00ff88" : "#ff4444";
      const winLabel = winningSide === "over" ? "OVER WINS!" : winningSide === "under" ? "UNDER WINS!" : "ROUND COMPLETE";
      const mascot = winningSide === "over" ? "/mascot/victory.gif" : winningSide === "under" ? "/mascot/victory2.gif" : "/mascot/payout.gif";

      playWinSound();
      showCard({
        id: "resolved-" + Date.now(),
        mascot,
        title: winLabel,
        subtitle: finalCount !== undefined ? `Final count: ${finalCount} vehicles` : undefined,
        color: winColor,
        duration: 5000,
        confetti: true,
        size: "big",
      });
    }

    // CANCELLED
    if (status === "cancelled" && prevStatus !== "cancelled") {
      showCard({
        id: "cancelled-" + Date.now(),
        mascot: "/mascot/chill.gif",
        title: "ROUND CANCELLED",
        subtitle: "No bets placed — next round starting",
        color: "#888888",
        duration: 3000,
      });
    }

    prevStatusRef.current = status;
    prevCountingRef.current = isCounting;
    prevUrgentRef.current = isUrgent;
  }, [status, isCounting, timeLeft, winningRangeIndex, finalCount, threshold]);

  // Cleanup
  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  return (
    <AnimatePresence>
      {card && (
        <motion.div
          key={card.id}
          initial={{ opacity: 0, scale: 0.8, y: 30 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: -20 }}
          transition={{ type: "spring", stiffness: 250, damping: 20 }}
          className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
        >
          <motion.div
            className="flex flex-col items-center gap-3 px-8 py-6 rounded-2xl"
            style={{
              background: `linear-gradient(145deg, rgba(10,10,10,0.95), ${card.color}18)`,
              border: `2px solid ${card.color}55`,
              boxShadow: `0 0 60px ${card.color}30, 0 0 120px ${card.color}10`,
              maxWidth: card.size === "big" ? 420 : 340,
              backdropFilter: "blur(8px)",
            }}
          >
            {/* Mascot */}
            <motion.img
              src={card.mascot}
              alt=""
              initial={{ scale: 0, rotate: -10 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 200, delay: 0.1 }}
              style={{
                width: card.size === "big" ? 110 : 80,
                height: card.size === "big" ? 110 : 80,
                filter: `drop-shadow(0 0 15px ${card.color}55)`,
              }}
            />

            {/* Count (for resolved) */}
            {card.size === "big" && finalCount !== undefined && (
              <motion.span
                initial={{ scale: 2, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", delay: 0.3 }}
                className="font-black tabular-nums"
                style={{
                  fontFamily: "monospace",
                  fontSize: 48,
                  color: card.color,
                  textShadow: `0 0 25px ${card.color}77`,
                  lineHeight: 1,
                }}
              >
                {String(finalCount).padStart(3, "0")}
              </motion.span>
            )}

            {/* Title */}
            <motion.span
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="text-xl font-black tracking-wider text-center"
              style={{
                color: card.color,
                fontFamily: "monospace",
                textShadow: `0 0 15px ${card.color}55`,
              }}
            >
              {card.title}
            </motion.span>

            {/* Subtitle */}
            {card.subtitle && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="text-sm text-center"
                style={{ color: "#aaa", fontFamily: "monospace" }}
              >
                {card.subtitle}
              </motion.span>
            )}

            {/* Threshold info for resolved */}
            {card.size === "big" && threshold > 0 && (
              <span className="text-xs" style={{ color: "#666", fontFamily: "monospace" }}>
                threshold: {threshold}
              </span>
            )}
          </motion.div>

          {/* Confetti particles */}
          {card.confetti && (
            <>
              {[...Array(16)].map((_, i) => (
                <motion.div
                  key={i}
                  initial={{
                    x: typeof window !== "undefined" ? Math.random() * window.innerWidth : 400,
                    y: -20,
                    opacity: 1,
                    scale: Math.random() * 0.6 + 0.4,
                  }}
                  animate={{
                    y: typeof window !== "undefined" ? window.innerHeight + 20 : 800,
                    x: `+=${Math.random() * 200 - 100}`,
                    rotate: Math.random() * 720,
                    opacity: 0,
                  }}
                  transition={{
                    duration: Math.random() * 2 + 2,
                    delay: Math.random() * 0.8,
                    ease: "easeIn",
                  }}
                  style={{
                    position: "fixed",
                    width: 8,
                    height: 8,
                    borderRadius: i % 2 === 0 ? "50%" : "2px",
                    background: [card.color, "#ffd700", "#ff44ff", "#00aaff", "#fff"][i % 5],
                    zIndex: 51,
                  }}
                />
              ))}
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
