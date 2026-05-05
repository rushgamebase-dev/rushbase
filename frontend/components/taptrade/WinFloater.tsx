"use client";

/**
 * WinFloater — short-lived "+0.005 ETH" announcement that pops in
 * the centre of the screen, hangs for a beat, then flies up to the
 * Balance display in the header. Communicates the win **viscerally**:
 * casinos that don't surface this lose trust ("did I actually win?").
 *
 * Phases:
 *   1. `pop`  (0–650 ms): scale-up + fade-in, hovers above the cell.
 *   2. `fly`  (650–1800 ms): translates to the balance ref, scaling
 *                            down + fading out as if absorbed.
 *   3. `gone` (1800 ms+):    onComplete fires; parent unmounts.
 *
 * The trajectory is computed from `from`/`to` viewport coords, not
 * a CSS keyframe, so it adapts to whichever balance widget is visible
 * (desktop card, mobile `+` button, …) without separate variants.
 */

import { useEffect, useRef, useState } from "react";

export interface WinFloaterProps {
  /** Amount won, in ETH (e.g. 0.0085). */
  amountEth: number;
  /** Multiplier paid (1.85, 2.4×, …) — shown as a subtitle. */
  multiplier?: number;
  /** Pixel coords (viewport-relative) where the floater pops in. */
  from: { x: number; y: number };
  /** Pixel coords (viewport-relative) where it should fly to —
   *  typically the centre of the Balance card in the header. */
  to: { x: number; y: number };
  /** Fired after phase `gone` so the parent removes the entry. */
  onComplete: () => void;
}

type Phase = "pop" | "fly" | "gone";

const POP_DURATION_MS = 650;
const FLY_DURATION_MS = 1150;

export function WinFloater({
  amountEth,
  multiplier,
  from,
  to,
  onComplete,
}: WinFloaterProps) {
  const [phase, setPhase] = useState<Phase>("pop");
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const flyTimer = window.setTimeout(() => setPhase("fly"), POP_DURATION_MS);
    const goneTimer = window.setTimeout(() => {
      setPhase("gone");
      onCompleteRef.current();
    }, POP_DURATION_MS + FLY_DURATION_MS);
    return () => {
      window.clearTimeout(flyTimer);
      window.clearTimeout(goneTimer);
    };
  }, []);

  if (phase === "gone") return null;

  const dx = phase === "fly" ? to.x - from.x : 0;
  const dy = phase === "fly" ? to.y - from.y : -36; // small lift during pop
  const scale = phase === "fly" ? 0.42 : 1.0;
  const opacity = phase === "fly" ? 0 : 1;

  const transition =
    phase === "fly"
      ? `transform ${FLY_DURATION_MS}ms cubic-bezier(0.65, 0.05, 0.36, 1), opacity ${FLY_DURATION_MS}ms ease-in`
      : `transform ${POP_DURATION_MS}ms cubic-bezier(0.18, 0.89, 0.32, 1.28), opacity ${POP_DURATION_MS - 200}ms ease-out`;

  const formatted = amountEth.toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        left: from.x,
        top: from.y,
        transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(${scale})`,
        opacity,
        transition,
        pointerEvents: "none",
        zIndex: 80,
      }}
      className="select-none"
    >
      <div
        className="rounded-xl border border-[#1aff84]/45 bg-[#02110a]/85 px-5 py-3 font-mono text-center shadow-[0_0_42px_rgba(0,255,102,0.6)] backdrop-blur-[2px]"
        style={{ textShadow: "0 0 22px rgba(0,255,102,0.55)" }}
      >
        <div className="font-sans text-[13px] font-black uppercase tracking-[0.32em] text-[#7dff9b]">
          win
        </div>
        <div className="mt-1 font-sans text-3xl font-black text-[#00ff66] sm:text-4xl">
          +{formatted}
          <span className="ml-1 align-baseline text-base text-[#9ec3aa] sm:text-lg">
            ETH
          </span>
        </div>
        {typeof multiplier === "number" && multiplier > 0 ? (
          <div className="mt-0.5 font-mono text-xs font-black uppercase tracking-widest text-[#7dff9b]/80">
            {multiplier.toFixed(2)}× hit
          </div>
        ) : null}
      </div>
    </div>
  );
}
