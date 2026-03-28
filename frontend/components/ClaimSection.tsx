"use client";

import { motion, AnimatePresence } from "framer-motion";
import { ExternalLink } from "lucide-react";
import { useClaimWinnings } from "@/hooks/useClaimWinnings";
import { BASE_MAINNET } from "@/lib/contracts";

interface ClaimSectionProps {
  marketAddress: `0x${string}` | null;
  marketState: number;
}

/**
 * Inline claim section for BettingPanel.
 * Replaces the BET button area when market is RESOLVED and user has winnings.
 *
 * Usage:
 *   <ClaimSection marketAddress={marketAddress} marketState={state} />
 */
export default function ClaimSection({ marketAddress, marketState }: ClaimSectionProps) {
  const { claim, claimable, claimableWei, isLoading, isSuccess, txHash, error } =
    useClaimWinnings(marketAddress);

  const isResolved = marketState === 2;
  const hasWinnings = claimableWei > BigInt(0);

  const explorerUrl = BASE_MAINNET.blockExplorerUrls[0];
  const claimableFormatted = parseFloat(claimable).toFixed(4);

  if (!isResolved || !hasWinnings) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="claim-section"
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="overflow-hidden"
      >
        <div
          className="px-4 py-4 flex flex-col gap-3"
          style={{
            background: "rgba(0,255,136,0.06)",
            borderBottom: "1px solid rgba(0,255,136,0.15)",
            borderTop: "1px solid rgba(0,255,136,0.15)",
          }}
        >
          {isSuccess && txHash ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span style={{ fontSize: 16 }}>🎉</span>
                <span
                  className="text-sm font-black tracking-widest"
                  style={{ color: "#00ff88", fontFamily: "monospace" }}
                >
                  CLAIMED
                </span>
              </div>
              <a
                href={`${explorerUrl}/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs transition-opacity hover:opacity-80"
                style={{ color: "#00cc70", fontFamily: "monospace" }}
              >
                <ExternalLink size={10} />
                {txHash.slice(0, 10)}...{txHash.slice(-6)}
              </a>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span style={{ fontSize: 16 }}>🎉</span>
                <div>
                  <div
                    className="text-xs font-bold tracking-widest"
                    style={{ color: "#00ff88", fontFamily: "monospace" }}
                  >
                    YOU WON
                  </div>
                  <div
                    className="text-lg font-black tabular"
                    style={{
                      color: "#00ff88",
                      fontFamily: "monospace",
                      textShadow: "0 0 12px rgba(0,255,136,0.5)",
                    }}
                  >
                    {claimableFormatted} ETH
                  </div>
                </div>
              </div>

              {error && (
                <div
                  className="text-xs px-2 py-1 rounded"
                  style={{
                    color: "#ff4444",
                    background: "rgba(255,68,68,0.08)",
                    fontFamily: "monospace",
                  }}
                >
                  {error.length > 100 ? error.slice(0, 100) + "..." : error}
                </div>
              )}

              <button
                onClick={() => void claim()}
                disabled={isLoading}
                className="w-full py-3.5 rounded font-black text-sm tracking-widest transition-all"
                style={{
                  background: isLoading
                    ? "rgba(0,255,136,0.12)"
                    : "rgba(0,255,136,0.9)",
                  color: isLoading ? "#00ff88" : "#000",
                  border: "1px solid rgba(0,255,136,0.5)",
                  fontFamily: "monospace",
                  letterSpacing: "0.12em",
                  cursor: isLoading ? "not-allowed" : "pointer",
                  boxShadow: isLoading ? "none" : "0 0 24px rgba(0,255,136,0.25)",
                }}
                aria-label={`Claim ${claimableFormatted} ETH winnings`}
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span
                      className="inline-block w-4 h-4 rounded-full border-2 border-current border-t-transparent"
                      style={{ animation: "spin 0.8s linear infinite" }}
                    />
                    CONFIRMING...
                  </span>
                ) : (
                  `CLAIM ${claimableFormatted} ETH`
                )}
              </button>
            </>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
