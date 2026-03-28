"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ExternalLink } from "lucide-react";
import { useClaimWinnings } from "@/hooks/useClaimWinnings";
import { BASE_MAINNET } from "@/lib/contracts";

interface ClaimBannerProps {
  marketAddress: `0x${string}` | null;
  marketState: number; // 2 = RESOLVED
}

/**
 * Full-width slide-in banner that appears when:
 *   - Market state === 2 (RESOLVED)
 *   - Connected user has claimable winnings > 0
 *
 * Usage:
 *   <ClaimBanner marketAddress={marketAddress} marketState={marketData.state} />
 */
export default function ClaimBanner({ marketAddress, marketState }: ClaimBannerProps) {
  const { claim, claimable, claimableWei, isLoading, isSuccess, txHash, error } =
    useClaimWinnings(marketAddress);

  const [dismissed, setDismissed] = useState(false);

  const isResolved = marketState === 2;
  const hasWinnings = claimableWei > BigInt(0);
  const shouldShow = isResolved && hasWinnings && !dismissed;

  // Auto-dismiss after successful claim (3 second delay so tx link is visible)
  useEffect(() => {
    if (isSuccess) {
      const t = setTimeout(() => setDismissed(true), 5000);
      return () => clearTimeout(t);
    }
  }, [isSuccess]);

  // Reset dismissed state when market changes
  useEffect(() => {
    setDismissed(false);
  }, [marketAddress]);

  const explorerUrl = BASE_MAINNET.blockExplorerUrls[0];
  const claimableFormatted = parseFloat(claimable).toFixed(4);

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.div
          key="claim-banner"
          initial={{ opacity: 0, y: -60, scaleY: 0.85 }}
          animate={{ opacity: 1, y: 0, scaleY: 1 }}
          exit={{ opacity: 0, y: -40, scaleY: 0.9 }}
          transition={{ type: "spring", stiffness: 320, damping: 28 }}
          style={{
            background: "linear-gradient(135deg, rgba(0,255,136,0.10) 0%, rgba(0,200,100,0.06) 100%)",
            border: "1px solid rgba(0,255,136,0.35)",
            boxShadow: "0 4px 32px rgba(0,255,136,0.18), inset 0 1px 0 rgba(0,255,136,0.12)",
            borderRadius: 6,
          }}
          className="mx-3 mt-3 px-4 py-4"
          role="alert"
          aria-live="polite"
        >
          {isSuccess && txHash ? (
            /* Post-claim success state */
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span style={{ fontSize: 18 }}>🎉</span>
                <span
                  className="text-sm font-black tracking-widest"
                  style={{ color: "#00ff88", fontFamily: "monospace" }}
                >
                  WINNINGS CLAIMED
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
                View on Basescan
                <span className="opacity-50 ml-1 font-mono">
                  {txHash.slice(0, 10)}...{txHash.slice(-6)}
                </span>
              </a>
            </div>
          ) : (
            /* Pre-claim state */
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 18 }}>🎉</span>
                  <span
                    className="text-sm font-black tracking-widest"
                    style={{ color: "#00ff88", fontFamily: "monospace" }}
                  >
                    YOU WON!
                  </span>
                </div>
                <div
                  className="text-xs"
                  style={{ color: "#aaa", fontFamily: "monospace", paddingLeft: 26 }}
                >
                  Your winnings are ready to claim
                </div>
                {error && (
                  <div
                    className="text-xs mt-1"
                    style={{ color: "#ff4444", fontFamily: "monospace", paddingLeft: 26 }}
                  >
                    {error.length > 80 ? error.slice(0, 80) + "..." : error}
                  </div>
                )}
              </div>

              <button
                onClick={() => void claim()}
                disabled={isLoading}
                className="shrink-0 px-5 py-2.5 rounded font-black text-sm tracking-widest transition-all"
                style={{
                  background: isLoading
                    ? "rgba(0,255,136,0.12)"
                    : "rgba(0,255,136,0.85)",
                  color: isLoading ? "#00ff88" : "#000",
                  border: "1px solid rgba(0,255,136,0.6)",
                  fontFamily: "monospace",
                  cursor: isLoading ? "not-allowed" : "pointer",
                  boxShadow: isLoading ? "none" : "0 0 20px rgba(0,255,136,0.3)",
                  minWidth: 160,
                }}
                aria-label={`Claim ${claimableFormatted} ETH winnings`}
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span
                      className="inline-block w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent"
                      style={{ animation: "spin 0.8s linear infinite" }}
                    />
                    CLAIMING...
                  </span>
                ) : (
                  `CLAIM ${claimableFormatted} ETH`
                )}
              </button>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
