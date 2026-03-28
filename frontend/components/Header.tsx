"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { Eye } from "lucide-react";
import { useEffect, useState } from "react";

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
      {/* Left: Logo */}
      <div className="flex items-center gap-6 min-w-0">
        <Link href="/" className="flex items-center gap-2 shrink-0">
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
        <nav className="hidden md:flex items-center gap-4">
          <Link
            href="/tiles"
            className="text-xs font-medium transition-colors"
            style={{ color: "#666", letterSpacing: "0.05em" }}
            onMouseEnter={(e) => ((e.target as HTMLElement).style.color = "#00ff88")}
            onMouseLeave={(e) => ((e.target as HTMLElement).style.color = "#666")}
          >
            TILES
          </Link>
          <Link
            href="/stats"
            className="text-xs font-medium transition-colors"
            style={{ color: "#666", letterSpacing: "0.05em" }}
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
          <span className="live-dot" />
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
          <Eye size={13} style={{ color: "#666" }} />
          <span
            className="text-xs tabular"
            style={{
              color: "#666",
              fontFamily: "monospace",
            }}
          >
            {viewers.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Right: Wallet */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Mobile live indicator */}
        <div className="flex md:hidden items-center gap-1.5">
          <span className="live-dot" />
          <span
            className="text-xs font-bold"
            style={{ color: "#ff4444", fontFamily: "monospace" }}
          >
            LIVE
          </span>
        </div>

        <ConnectButton
          chainStatus="none"
          showBalance={false}
          accountStatus="address"
        />
      </div>
    </header>
  );
}
