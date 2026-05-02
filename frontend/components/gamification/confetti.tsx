"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useGamification } from "@/stores";

// =============================================================================
// CONFETTI - Neon Green Celebration Effect
// =============================================================================

// TAPTRADER - Neon Green Confetti Colors
const CONFETTI_COLORS = [
  "#00ff41", // Neon green primary
  "#00cc33", // Neon green dark
  "#33ff66", // Neon green light
  "#66ff88", // Neon green lighter
  "#ffffff", // White accent
  "#00ffaa", // Cyan-green
];

const CONFETTI_COUNT = 60;

interface ConfettiPiece {
  id: number;
  x: number;
  color: string;
  delay: number;
  rotation: number;
  size: number;
  type: "square" | "line" | "dot";
}

export function Confetti() {
  const { showConfetti, setShowConfetti } = useGamification();
  const [pieces, setPieces] = useState<ConfettiPiece[]>([]);

  useEffect(() => {
    if (showConfetti) {
      const newPieces: ConfettiPiece[] = Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        delay: Math.random() * 0.4,
        rotation: Math.random() * 360,
        size: 6 + Math.random() * 8,
        type: ["square", "line", "dot"][Math.floor(Math.random() * 3)] as "square" | "line" | "dot",
      }));
      setPieces(newPieces);

      const timeout = setTimeout(() => {
        setShowConfetti(false);
      }, 3500);

      return () => clearTimeout(timeout);
    }
  }, [showConfetti, setShowConfetti]);

  return (
    <AnimatePresence>
      {showConfetti && (
        <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
          {pieces.map((piece) => (
            <motion.div
              key={piece.id}
              initial={{
                x: `${piece.x}vw`,
                y: -20,
                rotate: 0,
                opacity: 1,
                scale: 0,
              }}
              animate={{
                y: "100vh",
                rotate: piece.rotation + 720,
                opacity: [1, 1, 1, 0],
                scale: [0, 1, 1, 0.5],
              }}
              exit={{ opacity: 0 }}
              transition={{
                duration: 2.5 + Math.random(),
                delay: piece.delay,
                ease: "easeOut",
              }}
              style={{
                backgroundColor: piece.color,
                boxShadow: `0 0 ${piece.size}px ${piece.color}`,
                width: piece.type === "line" ? 2 : piece.size,
                height: piece.type === "dot" ? piece.size : piece.type === "line" ? piece.size * 2 : piece.size,
                borderRadius: piece.type === "dot" ? "50%" : "1px",
              }}
              className="absolute"
            />
          ))}
        </div>
      )}
    </AnimatePresence>
  );
}

// =============================================================================
// WIN OVERLAY - TAPTRADER THEME - Flashes on Win
// =============================================================================

interface WinOverlayProps {
  show: boolean;
  amount: number;
  onComplete?: () => void;
}

export function WinOverlay({ show, amount, onComplete }: WinOverlayProps) {
  useEffect(() => {
    if (show && onComplete) {
      const timeout = setTimeout(onComplete, 1500);
      return () => clearTimeout(timeout);
    }
  }, [show, onComplete]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 pointer-events-none z-50 flex items-center justify-center"
        >
          {/* Green flash overlay */}
          <motion.div
            initial={{ opacity: 0.3 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="absolute inset-0 bg-neon"
          />

          {/* Win text */}
          <motion.div
            initial={{ scale: 0, rotate: -10 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 2, opacity: 0 }}
            transition={{ type: "spring", damping: 15 }}
            className="text-center"
          >
            <motion.p
              animate={{
                textShadow: [
                  "0 0 20px rgba(0, 255, 65, 0.8)",
                  "0 0 40px rgba(0, 255, 65, 1)",
                  "0 0 20px rgba(0, 255, 65, 0.8)",
                ],
              }}
              transition={{ duration: 0.5, repeat: 2 }}
              className="text-6xl font-mono font-black text-neon"
            >
              +${amount.toFixed(2)}
            </motion.p>
            <p className="text-2xl font-mono font-bold text-neon-400 mt-2">WIN!</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// =============================================================================
// LOSS OVERLAY - TAPTRADER THEME - Flashes on Loss
// =============================================================================

interface LossOverlayProps {
  show: boolean;
  amount: number;
  onComplete?: () => void;
}

export function LossOverlay({ show, amount, onComplete }: LossOverlayProps) {
  useEffect(() => {
    if (show && onComplete) {
      const timeout = setTimeout(onComplete, 1200);
      return () => clearTimeout(timeout);
    }
  }, [show, onComplete]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 pointer-events-none z-50 flex items-center justify-center"
        >
          {/* Red flash overlay */}
          <motion.div
            initial={{ opacity: 0.2 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-0 bg-short"
          />

          {/* Loss text */}
          <motion.div
            initial={{ scale: 0.8, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ type: "spring", damping: 20 }}
            className="text-center"
          >
            <motion.p
              animate={{
                x: [-3, 3, -3, 3, 0],
              }}
              transition={{ duration: 0.3 }}
              className="text-5xl font-mono font-black text-short"
              style={{ textShadow: "0 0 20px rgba(255, 51, 51, 0.8)" }}
            >
              -${Math.abs(amount).toFixed(2)}
            </motion.p>
            <p className="text-xl font-mono font-bold text-short/70 mt-2">LOSS</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// =============================================================================
// BIG WIN OVERLAY - TAPTRADER THEME - Spectacular Win Animation
// =============================================================================

interface BigWinOverlayProps {
  show: boolean;
  amount: number;
  multiplier?: number;
  onComplete?: () => void;
}

export function BigWinOverlay({ show, amount, multiplier = 1, onComplete }: BigWinOverlayProps) {
  useEffect(() => {
    if (show && onComplete) {
      const timeout = setTimeout(onComplete, 2500);
      return () => clearTimeout(timeout);
    }
  }, [show, onComplete]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 pointer-events-none z-50 flex items-center justify-center bg-black/60"
        >
          {/* Radial burst lines */}
          {[...Array(12)].map((_, i) => (
            <motion.div
              key={i}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: [0, 2], opacity: [0.8, 0] }}
              transition={{ duration: 1, delay: i * 0.05 }}
              className="absolute w-1 h-32 bg-gradient-to-t from-transparent to-neon"
              style={{
                transformOrigin: "bottom center",
                rotate: `${(i / 12) * 360}deg`,
              }}
            />
          ))}

          {/* Main content */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0, rotate: 10 }}
            transition={{ type: "spring", damping: 12 }}
            className="text-center relative z-10"
          >
            {/* Glow ring */}
            <motion.div
              animate={{
                boxShadow: [
                  "0 0 40px rgba(0, 255, 65, 0.5)",
                  "0 0 80px rgba(0, 255, 65, 0.8)",
                  "0 0 40px rgba(0, 255, 65, 0.5)",
                ],
              }}
              transition={{ duration: 1, repeat: Infinity }}
              className="absolute inset-[-40px] rounded-full"
            />

            {/* Title */}
            <motion.p
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 0.5, repeat: 2 }}
              className="text-3xl font-mono font-black text-neon-300 tracking-widest mb-2"
              style={{ textShadow: "0 0 30px rgba(0, 255, 65, 1)" }}
            >
              BIG WIN!
            </motion.p>

            {/* Amount */}
            <motion.p
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="text-7xl font-mono font-black text-neon"
              style={{ textShadow: "0 0 40px rgba(0, 255, 65, 0.8)" }}
            >
              +${amount.toFixed(2)}
            </motion.p>

            {/* Multiplier */}
            {multiplier > 1 && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.5, type: "spring" }}
                className="mt-3 inline-block px-4 py-1 bg-neon-muted border border-border-neon rounded"
              >
                <span className="font-mono font-bold text-neon text-xl">{multiplier.toFixed(1)}x MULTIPLIER</span>
              </motion.div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
