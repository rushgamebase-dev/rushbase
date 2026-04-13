"use client";

import { useState } from "react";
import { Share2, Check } from "lucide-react";

interface ShareButtonProps {
  title?: string;
  text?: string;
  url?: string;
  /** Label hidden on mobile (icon only) */
  label?: string;
  compact?: boolean;
}

/**
 * Opens the native share sheet (WebShare API) on mobile; falls back to
 * copying the URL to clipboard on desktop / unsupported browsers.
 */
export default function ShareButton({
  title = "Rush — Live Prediction Market",
  text = "On-chain prediction market on live traffic cameras. Bet ETH, split the pool, tile holders earn 5%.",
  url = typeof window !== "undefined" ? window.location.href : "https://rushgame.vip",
  label = "Share",
  compact = false,
}: ShareButtonProps) {
  const [copied, setCopied] = useState(false);

  async function onShare() {
    navigator.vibrate?.(6);
    const shareUrl = typeof window !== "undefined" ? window.location.href : url;
    const payload = { title, text, url: shareUrl };
    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share(payload);
        return;
      }
    } catch {
      // user dismissed the share sheet — fall through to copy
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard denied — no-op
    }
  }

  return (
    <button
      onClick={onShare}
      aria-label="Share"
      className="flex items-center gap-1.5 px-2.5 rounded font-mono transition-colors"
      style={{
        height: 32,
        background: "#111",
        border: "1px solid #1a1a1a",
        color: copied ? "#00ff88" : "#aaa",
        fontSize: 11,
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {copied ? <Check size={13} /> : <Share2 size={13} />}
      {!compact && (
        <span style={{ letterSpacing: "0.05em" }}>
          {copied ? "COPIED" : label.toUpperCase()}
        </span>
      )}
    </button>
  );
}
