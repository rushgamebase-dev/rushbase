"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { BarChart3, CircleDollarSign, Gamepad2, Swords } from "lucide-react";
import { WalletButton } from "@/components/WalletButton";
import ShareButton from "@/components/ShareButton";
import { useAccount } from "wagmi";

// Admin wallet addresses — only these see the ADMIN nav link
const ADMIN_ADDRESSES = [
  "0xdd12D83786C2BAc7be3D59869834C23E91449A2D",
].map((a) => a.toLowerCase());

const MOBILE_NAV = [
  { href: "/", label: "Play", icon: Gamepad2 },
  { href: "/arenas", label: "Arenas", icon: Swords },
  { href: "/trade", label: "Trade", icon: BarChart3 },
  { href: "/stake", label: "Stake", icon: CircleDollarSign },
];

function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Header() {
  const { address } = useAccount();
  const pathname = usePathname();
  const isAdmin = !!address && ADMIN_ADDRESSES.includes(address.toLowerCase());

  return (
    <>
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
        <nav className="hidden items-center gap-1.5 sm:gap-2 md:gap-4 xl:flex" aria-label="Main navigation">
          <Link
            href="/"
            className="text-[11px] md:text-xs font-medium transition-colors whitespace-nowrap"
            style={{ color: "#666", letterSpacing: "0.05em", fontFamily: "monospace" }}
            onMouseEnter={(e) => ((e.target as HTMLElement).style.color = "#00ff88")}
            onMouseLeave={(e) => ((e.target as HTMLElement).style.color = "#666")}
          >
            PREDICT
          </Link>

          <a
            href="https://markets.rushgame.vip/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] md:text-xs font-medium transition-colors whitespace-nowrap"
            style={{ color: "#00aaff", letterSpacing: "0.05em", fontFamily: "monospace" }}
            onMouseEnter={(e) => ((e.target as HTMLElement).style.color = "#44ccff")}
            onMouseLeave={(e) => ((e.target as HTMLElement).style.color = "#00aaff")}
          >
            MARKETS
          </a>

          <Link
            href="/tiles"
            className="flex items-center gap-1 text-[11px] md:text-xs font-bold transition-colors whitespace-nowrap"
            style={{ color: "#ffd700", letterSpacing: "0.05em", fontFamily: "monospace" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "#fff08a")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "#ffd700")}
          >
            TILES
            <span
              className="px-1 py-0.5 rounded text-center"
              style={{
                fontSize: 10,
                background: "rgba(255,215,0,0.12)",
                border: "1px solid rgba(255,215,0,0.3)",
                color: "#ffd700",
                fontFamily: "monospace",
                letterSpacing: "0.06em",
                lineHeight: 1,
              }}
            >
              LEDGER
            </span>
          </Link>

          {/* TRADE — touch-betting arena. Highlighted in
              the same neon-cyan palette as the in-game canvas accents
              so the menu surface matches what the player sees once
              they land on /trade. */}
          <Link
            href="/trade"
            className="flex items-center gap-1 text-[11px] md:text-xs font-bold transition-colors whitespace-nowrap"
            style={{ color: "#00ff66", letterSpacing: "0.05em", fontFamily: "monospace" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "#5dffaa")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "#00ff66")}
          >
            TRADE
            <span
              className="px-1 py-0.5 rounded text-center"
              style={{
                fontSize: 10,
                background: "rgba(0,255,102,0.12)",
                border: "1px solid rgba(0,255,102,0.3)",
                color: "#00ff66",
                fontFamily: "monospace",
                letterSpacing: "0.06em",
                lineHeight: 1,
              }}
            >
              NEW
            </span>
          </Link>

          {/* Rush Arenas exposes the battle-arena module under Rush naming. */}
          <Link
            href="/arenas"
            className="flex items-center gap-1 text-[11px] md:text-xs font-bold transition-colors whitespace-nowrap"
            style={{ color: "#00ddff", letterSpacing: "0.05em", fontFamily: "monospace" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "#66f0ff")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "#00ddff")}
          >
            ARENAS
            <span
              className="px-1 py-0.5 rounded text-center"
              style={{
                fontSize: 10,
                background: "rgba(0,221,255,0.12)",
                border: "1px solid rgba(0,221,255,0.3)",
                color: "#00ddff",
                fontFamily: "monospace",
                letterSpacing: "0.06em",
                lineHeight: 1,
              }}
            >
              AI
            </span>
          </Link>

          {/* STAKE — single-sided $RUSH staking, ETH rewards from
              Rush Trade house edge. Synthetix accumulator pattern,
              live earned counter on the page. */}
          <Link
            href="/stake"
            className="flex items-center gap-1 text-[11px] md:text-xs font-bold transition-colors whitespace-nowrap"
            style={{ color: "#1aff84", letterSpacing: "0.05em", fontFamily: "monospace" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "#7dffaa")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "#1aff84")}
          >
            STAKE
            <span
              className="px-1 py-0.5 rounded text-center"
              style={{
                fontSize: 10,
                background: "rgba(26,255,132,0.12)",
                border: "1px solid rgba(26,255,132,0.3)",
                color: "#1aff84",
                fontFamily: "monospace",
                letterSpacing: "0.06em",
                lineHeight: 1,
              }}
            >
              NEW
            </span>
          </Link>

          <Link
            href="/leaderboard"
            className="text-[11px] md:text-xs font-medium transition-colors whitespace-nowrap"
            style={{ color: "#666", letterSpacing: "0.05em", fontFamily: "monospace" }}
            onMouseEnter={(e) => ((e.target as HTMLElement).style.color = "#00ff88")}
            onMouseLeave={(e) => ((e.target as HTMLElement).style.color = "#666")}
          >
            RANKS
          </Link>

          <Link
            href="/stats"
            className="text-[11px] md:text-xs font-medium transition-colors whitespace-nowrap"
            style={{ color: "#666", letterSpacing: "0.05em", fontFamily: "monospace" }}
            onMouseEnter={(e) => ((e.target as HTMLElement).style.color = "#00ff88")}
            onMouseLeave={(e) => ((e.target as HTMLElement).style.color = "#666")}
          >
            STATS
          </Link>

          <Link
            href="/docs"
            className="text-[11px] md:text-xs font-medium transition-colors whitespace-nowrap"
            style={{ color: "#666", letterSpacing: "0.05em", fontFamily: "monospace" }}
            onMouseEnter={(e) => ((e.target as HTMLElement).style.color = "#00ff88")}
            onMouseLeave={(e) => ((e.target as HTMLElement).style.color = "#666")}
          >
            DOCS
          </Link>

          <Link
            href="/transparency"
            className="text-[11px] md:text-xs font-medium transition-colors whitespace-nowrap"
            style={{ color: "#666", letterSpacing: "0.05em", fontFamily: "monospace" }}
            onMouseEnter={(e) => ((e.target as HTMLElement).style.color = "#ffd700")}
            onMouseLeave={(e) => ((e.target as HTMLElement).style.color = "#666")}
          >
            LEDGER
          </Link>

          {address && (
            <Link
              href="/profile/me"
              className="text-[11px] md:text-xs font-medium transition-colors whitespace-nowrap"
              style={{ color: "#666", letterSpacing: "0.05em", fontFamily: "monospace" }}
              onMouseEnter={(e) => ((e.target as HTMLElement).style.color = "#00ff88")}
              onMouseLeave={(e) => ((e.target as HTMLElement).style.color = "#666")}
            >
              PROFILE
            </Link>
          )}

          {/* ADMIN — only shown to admin wallets */}
          {isAdmin && (
            <Link
              href="/admin"
              className="flex items-center gap-1.5 text-xs font-bold transition-colors"
              style={{ color: "#ff4444", letterSpacing: "0.05em", fontFamily: "monospace" }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "#ff6666")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "#ff4444")}
              aria-label="Admin panel"
            >
              ADMIN
              <span
                style={{
                  fontSize: 10,
                  padding: "1px 5px",
                  borderRadius: 3,
                  background: "rgba(255,68,68,0.12)",
                  border: "1px solid rgba(255,68,68,0.3)",
                  color: "#ff4444",
                  fontFamily: "monospace",
                  letterSpacing: "0.06em",
                  lineHeight: 1.4,
                }}
              >
                SYS
              </span>
            </Link>
          )}
        </nav>
      </div>

      {/* Center: Live status */}
      <div
        className="absolute left-1/2 -translate-x-1/2 hidden 2xl:flex items-center gap-3"
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
          Live Prediction Market
        </span>
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

        <ShareButton compact />
        <WalletButton />
      </div>
    </header>

      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-[#172018] bg-[#060806]/96 px-2 pb-[calc(env(safe-area-inset-bottom)+6px)] pt-2 backdrop-blur-xl xl:hidden" aria-label="Primary mobile navigation">
        <div className="mx-auto grid max-w-md grid-cols-4 gap-1">
          {MOBILE_NAV.map((item) => {
            const Icon = item.icon;
            const active = isActivePath(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-lg border text-[10px] font-black uppercase tracking-[0.08em] transition-colors"
                style={{
                  borderColor: active ? "rgba(0,255,136,0.45)" : "transparent",
                  background: active ? "rgba(0,255,136,0.12)" : "transparent",
                  color: active ? "#00ff88" : "#7a8a80",
                  fontFamily: "monospace",
                }}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
