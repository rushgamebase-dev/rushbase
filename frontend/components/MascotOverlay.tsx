"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface MascotOverlayProps {
  status: "open" | "locked" | "resolving" | "resolved" | "cancelled";
  winningRangeIndex?: number;
  finalCount?: number;
  threshold?: number;
  /** Did the connected user win? */
  userWon?: boolean;
  /** Did the connected user lose? */
  userLost?: boolean;
  /** Total payout for user */
  userPayout?: number;
}

// Full-screen overlay events for major round moments
export default function MascotOverlay({
  status,
  winningRangeIndex = -1,
  finalCount,
  threshold = 0,
  userWon,
  userLost,
  userPayout,
}: MascotOverlayProps) {
  const [show, setShow] = useState(false);
  const [event, setEvent] = useState<"resolved" | "cancelled" | null>(null);
  const prevStatus = useState(status)[0];

  useEffect(() => {
    if (status === "resolved" && prevStatus !== "resolved") {
      setEvent("resolved");
      setShow(true);
      const t = setTimeout(() => setShow(false), 5000);
      return () => clearTimeout(t);
    }
  }, [status, prevStatus]);

  const winningSide = winningRangeIndex === 1 ? "over" : winningRangeIndex === 0 ? "under" : null;
  const winColor = winningSide === "over" ? "#00ff88" : "#ff4444";

  // Pick mascot based on user outcome
  let mascotGif = "/mascot/victory.gif";
  let messageTop = "";
  let messageSub = "";

  if (userWon) {
    mascotGif = "/mascot/happy-dance.gif";
    messageTop = "YOU WON!";
    messageSub = userPayout ? `+${userPayout.toFixed(4)} ETH` : "Congrats!";
  } else if (userLost) {
    mascotGif = "/mascot/lost.gif";
    messageTop = "BETTER LUCK NEXT TIME";
    messageSub = "New round starting soon...";
  } else if (winningSide) {
    mascotGif = winningSide === "over" ? "/mascot/victory1.gif" : "/mascot/victory2.gif";
    messageTop = winningSide === "over" ? "OVER WINS!" : "UNDER WINS!";
    messageSub = finalCount !== undefined ? `Final count: ${finalCount} vehicles` : "";
  }

  return (
    <AnimatePresence>
      {show && event === "resolved" && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
          className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
        >
          <motion.div
            initial={{ scale: 0.5, y: 50 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.5, y: -50, opacity: 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 15 }}
            className="flex flex-col items-center gap-4 p-8 rounded-2xl"
            style={{
              background: `linear-gradient(145deg, rgba(10,10,10,0.95), ${winColor}15)`,
              border: `2px solid ${winColor}55`,
              boxShadow: `0 0 60px ${winColor}30, 0 0 120px ${winColor}15`,
              maxWidth: 400,
            }}
          >
            {/* Mascot */}
            <motion.img
              src={mascotGif}
              alt="Rush Mascot"
              initial={{ scale: 0, rotate: -15 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", delay: 0.2 }}
              style={{
                width: 120,
                height: 120,
                filter: `drop-shadow(0 0 20px ${winColor}66)`,
              }}
            />

            {/* Count reveal */}
            {finalCount !== undefined && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", delay: 0.4 }}
                className="text-center"
              >
                <span
                  className="font-black tabular-nums block"
                  style={{
                    fontFamily: "monospace",
                    fontSize: 56,
                    color: winColor,
                    textShadow: `0 0 30px ${winColor}88`,
                    lineHeight: 1,
                  }}
                >
                  {String(finalCount).padStart(3, "0")}
                </span>
                <span className="text-xs" style={{ color: "#888", fontFamily: "monospace" }}>
                  vehicles counted {threshold > 0 ? `(threshold: ${threshold})` : ""}
                </span>
              </motion.div>
            )}

            {/* Message */}
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="text-center"
            >
              <span
                className="text-2xl font-black tracking-wider block"
                style={{
                  color: userWon ? "#ffd700" : userLost ? "#888" : winColor,
                  fontFamily: "monospace",
                  textShadow: userWon ? "0 0 20px rgba(255,215,0,0.5)" : "none",
                }}
              >
                {messageTop}
              </span>
              <span className="text-sm block mt-1" style={{ color: userWon ? "#00ff88" : "#aaa", fontFamily: "monospace" }}>
                {messageSub}
              </span>
            </motion.div>

            {/* Payout animation */}
            {userWon && userPayout && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: [0, 1.2, 1] }}
                transition={{ delay: 0.8, duration: 0.5 }}
                className="flex items-center gap-2 px-4 py-2 rounded-full"
                style={{
                  background: "rgba(0,255,136,0.15)",
                  border: "1px solid rgba(0,255,136,0.4)",
                }}
              >
                <img src="/mascot/payout.gif" alt="" style={{ width: 24, height: 24 }} />
                <span className="font-black" style={{ color: "#00ff88", fontFamily: "monospace" }}>
                  +{userPayout.toFixed(4)} ETH
                </span>
              </motion.div>
            )}

            {/* Tap to dismiss hint */}
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.4 }}
              transition={{ delay: 2 }}
              className="text-xs"
              style={{ color: "#555", fontFamily: "monospace" }}
            >
              auto-closing in a few seconds...
            </motion.span>
          </motion.div>

          {/* Floating confetti-like particles for wins */}
          {(userWon || winningSide) && (
            <>
              {[...Array(12)].map((_, i) => (
                <motion.div
                  key={i}
                  initial={{
                    x: Math.random() * (typeof window !== "undefined" ? window.innerWidth : 800),
                    y: -20,
                    opacity: 1,
                    scale: Math.random() * 0.5 + 0.5,
                  }}
                  animate={{
                    y: (typeof window !== "undefined" ? window.innerHeight : 600) + 20,
                    x: `+=${Math.random() * 200 - 100}`,
                    rotate: Math.random() * 720,
                    opacity: 0,
                  }}
                  transition={{ duration: Math.random() * 2 + 2, delay: Math.random() * 1, ease: "easeIn" }}
                  style={{
                    position: "fixed",
                    width: 8,
                    height: 8,
                    borderRadius: i % 2 === 0 ? "50%" : "2px",
                    background: [winColor, "#ffd700", "#ff44ff", "#00aaff", "#ffffff"][i % 5],
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
