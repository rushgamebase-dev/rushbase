"use client";

import type { Outcome } from "@/types/market";

interface OutcomesListProps {
  outcomes: Outcome[];
  flashingIds: Set<string>;
  marketIcon?: string;
  onSelectOutcome?: (outcomeId: string) => void;
}

const OUTCOME_COLORS = [
  "var(--primary)",
  "var(--danger)",
  "var(--gold)",
  "#4488ff",
  "#aa44ff",
];

const OUTCOME_BORDER_COLORS = [
  "rgba(0, 255, 136, 0.35)",
  "rgba(255, 68, 68, 0.35)",
  "rgba(255, 215, 0, 0.35)",
  "rgba(68, 136, 255, 0.35)",
  "rgba(170, 68, 255, 0.35)",
];

export default function OutcomesList({
  outcomes,
  flashingIds,
  marketIcon,
  onSelectOutcome,
}: OutcomesListProps) {
  return (
    <div role="region" aria-label="Market outcomes">
      {/* Header row */}
      <div
        className="flex items-center justify-between mb-3 pb-3"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <span
          className="text-sm font-bold"
          style={{ color: "var(--text)" }}
        >
          Chance
        </span>
      </div>

      {/* Outcome rows */}
      <ul
        className="flex flex-col"
        role="list"
        aria-label="Possible outcomes"
        style={{ listStyle: "none", padding: 0, margin: 0 }}
      >
        {outcomes.map((outcome, idx) => {
          const isFlashing = flashingIds.has(outcome.id);
          const color = OUTCOME_COLORS[idx % OUTCOME_COLORS.length];
          const borderColor = OUTCOME_BORDER_COLORS[idx % OUTCOME_BORDER_COLORS.length];
          const noProb = Math.max(0, 100 - outcome.probability);

          // Synthesise a small change indicator from odds (cosmetic only)
          const changeSign = idx % 3 === 0 ? -1 : 1;
          const changeAmt = ((outcome.probability * 0.003 + 0.05) * changeSign).toFixed(1);
          const isPositiveChange = parseFloat(changeAmt) >= 0;

          return (
            <li
              key={outcome.id}
              className="flex items-center py-3 gap-3"
              style={{ borderBottom: "1px solid var(--border)" }}
              aria-label={`${outcome.label}: ${outcome.probability}% chance`}
            >
              {/* Icon / avatar */}
              <span
                className="text-xl shrink-0 leading-none"
                aria-hidden="true"
              >
                {marketIcon ?? "●"}
              </span>

              {/* Name */}
              <span
                className="font-semibold flex-1 min-w-0 text-sm truncate"
                style={{ color: "var(--text)" }}
              >
                {outcome.label}
              </span>

              {/* Probability */}
              <span
                className={`text-xl font-black tabular shrink-0 ${isFlashing ? "odds-flash" : ""}`}
                style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}
                aria-label={`${outcome.probability}% probability`}
              >
                {outcome.probability}%
              </span>

              {/* Change indicator */}
              <span
                className="text-xs tabular shrink-0 w-12 text-right"
                style={{
                  color: isPositiveChange ? "var(--primary)" : "var(--danger)",
                  fontVariantNumeric: "tabular-nums",
                }}
                aria-hidden="true"
              >
                {isPositiveChange ? "▲" : "▼"} {Math.abs(parseFloat(changeAmt))}
              </span>

              {/* Yes button */}
              <button
                className="px-3 py-1.5 rounded-full text-xs font-bold shrink-0 transition-all"
                style={{
                  border: `1px solid ${borderColor.replace("0.35", "0.5")}`,
                  color: color,
                  background: "transparent",
                  cursor: onSelectOutcome ? "pointer" : "default",
                  minWidth: 64,
                }}
                onClick={() => onSelectOutcome?.(outcome.id)}
                onMouseEnter={(e) => {
                  if (onSelectOutcome) {
                    const el = e.currentTarget as HTMLElement;
                    el.style.background = color.replace(")", ", 0.12)").replace("var(--primary)", "rgba(0,255,136,0.12)").replace("var(--danger)", "rgba(255,68,68,0.12)").replace("var(--gold)", "rgba(255,215,0,0.12)");
                  }
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                }}
                aria-label={`Buy Yes on ${outcome.label} at ${outcome.probability} cents`}
              >
                Yes {outcome.probability}¢
              </button>

              {/* No button */}
              <button
                className="px-3 py-1.5 rounded-full text-xs font-bold shrink-0 transition-all"
                style={{
                  border: "1px solid rgba(255, 68, 68, 0.4)",
                  color: "var(--danger)",
                  background: "transparent",
                  cursor: onSelectOutcome ? "pointer" : "default",
                  minWidth: 64,
                }}
                onClick={() => onSelectOutcome?.(outcome.id)}
                onMouseEnter={(e) => {
                  if (onSelectOutcome) {
                    (e.currentTarget as HTMLElement).style.background = "rgba(255,68,68,0.08)";
                  }
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                }}
                aria-label={`Buy No on ${outcome.label} at ${noProb} cents`}
              >
                No {noProb}¢
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
