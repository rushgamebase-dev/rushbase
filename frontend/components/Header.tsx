"use client";

import Link from "next/link";
import Image from "next/image";
import { Eye } from "lucide-react";
import { useEffect, useState } from "react";
import { WalletButton } from "@/components/WalletButton";

interface HeaderProps {
  viewerCount?: number;
}

export default function Header({ viewerCount = 247 }: HeaderProps) {
  const [viewers, setViewers] = useState(viewerCount);

  useEffect(() => {
    const interval = setInterval(() => {
      setViewers((v) => Math.max(100, v + Math.floor(Math.random() * 5) - 2));
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header
      className="sticky top-0 z-50 flex items-center justify-between px-4 h-14"
      style={{
        background: "rgba(10,10,10,0.92)",
        backdropFilter: "blur(16px)",
        borderBottom: "1px solid #1a1a1a",
      }}
    >
      {/* Left: Logo + nav */}
      <div className="flex items-center gap-6 min-w-0">
        <Link href="/" className="flex items-center gap-2 shrink-0" aria-label="Rush — Home">
          <Image
            src="/logo.png"
            alt="Rush logo"
            width={36}
            height={36}
            style={{ height: 36, width: "auto", objectFit: "contain" }}
            priority
          />
          <span
            className="text-xl font-black tracking-widest"
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
              color: "#00ff88",
              textShadow: "0 0 12px rgba(0,255,136,0.5)",
              letterSpacing: "0.2em",
            }}
          >
            RUSH
          </span>
        </Link>

        {/* Nav links */}
        <nav className="hidden md:flex items-center gap-4" aria-label="Main navigation">
          <Link
            href="/"
            className="text-xs font-medium transition-colors"
            style={{ color: "#666", letterSpacing: "0.05em", fontFamily: "monospace" }}
            onMouseEnter={(e) => ((e.target as HTMLElement).style.color = "#00ff88")}
            onMouseLeave={(e) => ((e.target as HTMLElement).style.color = "#666")}
          >
            PREDICT
          </Link>

          {/* TILES — highlighted with gold color */}
          <Link
            href="/tiles"
            className="flex items-center gap-1.5 text-xs font-bold transition-colors"
            style={{ color: "#ffd700", letterSpacing: "0.05em", fontFamily: "monospace" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "#ffe44d")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "#ffd700")}
          >
            TILES
            <span
              className="px-1 py-0.5 rounded text-center"
              style={{
                fontSize: 9,
                background: "rgba(255,215,0,0.12)",
                border: "1px solid rgba(255,215,0,0.3)",
                color: "#ffd700",
                fontFamily: "monospace",
                letterSpacing: "0.06em",
                lineHeight: 1,
              }}
            >
              EARN
            </span>
          </Link>

          <Link
            href="/stats"
            className="text-xs font-medium transition-colors"
            style={{ color: "#666", letterSpacing: "0.05em", fontFamily: "monospace" }}
            onMouseEnter={(e) => ((e.target as HTMLElement).style.color = "#00ff88")}
            onMouseLeave={(e) => ((e.target as HTMLElement).style.color = "#666")}
          >
            STATS
          </Link>
        </nav>
      </div>

      {/* Center: Live status */}
      <div
        className="absolute left-1/2 -translate-x-1/2 hidden md:flex items-center gap-3"
        style={{ color: "#e0e0e0" }}
      >
        <div className="flex items-center gap-2">
          <span className="live-dot" aria-hidden="true" />
          <span
            className="text-xs font-bold tracking-widest"
            style={{ color: "#ff4444", fontFamily: "monospace" }}
          >
            LIVE
          </span>
        </div>
        <span style={{ color: "#333" }}>|</span>
        <span className="text-sm font-medium" style={{ color: "#aaa" }}>
          Peace Bridge — USA/Canada
        </span>
        <span style={{ color: "#333" }}>|</span>
        <div className="flex items-center gap-1.5">
          <Eye size={13} style={{ color: "#666" }} aria-hidden="true" />
          <span
            className="text-xs tabular"
            style={{
              color: "#666",
              fontFamily: "monospace",
            }}
            aria-label={`${viewers.toLocaleString()} viewers`}
          >
            {viewers.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Right: Wallet */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Mobile live indicator */}
        <div className="flex md:hidden items-center gap-1.5" aria-hidden="true">
          <span className="live-dot" />
          <span
            className="text-xs font-bold"
            style={{ color: "#ff4444", fontFamily: "monospace" }}
          >
            LIVE
          </span>
        </div>

        <WalletButton />
      </div>
    </header>
  );
}
