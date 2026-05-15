"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  CircleDollarSign,
  Database,
  Home,
  Swords,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { WalletButton } from "@/components/WalletButton";
import ShareButton from "@/components/ShareButton";
import { useAccount } from "wagmi";

// Admin wallet addresses — only these see the ADMIN nav link
const ADMIN_ADDRESSES = [
  "0xdd12D83786C2BAc7be3D59869834C23E91449A2D",
].map((a) => a.toLowerCase());

const DESKTOP_NAV: Array<{
  href: string;
  label: string;
  accent?: string;
  badge?: string;
  icon: LucideIcon;
}> = [
  { href: "/", label: "Home", accent: "#00ff88", icon: Home },
  { href: "/trade", label: "Tap Trading", accent: "#00ff66", badge: "LIVE", icon: BarChart3 },
  { href: "/arenas", label: "Royale", accent: "#00ddff", badge: "PLAY", icon: Swords },
  { href: "/stake", label: "Stake", accent: "#1aff84", icon: CircleDollarSign },
  { href: "/leaderboard", label: "Ranks", icon: Trophy },
  { href: "/stats", label: "Stats", icon: BarChart3 },
  { href: "/docs", label: "Docs", icon: BookOpen },
  { href: "/transparency", label: "Ledger", accent: "#ffd700", icon: Database },
];

const MOBILE_NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/trade", label: "Tap Trading", icon: BarChart3 },
  { href: "/arenas", label: "Royale", icon: Swords },
  { href: "/transparency", label: "Ledger", icon: Database },
];

function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function navColor(active: boolean, accent?: string) {
  if (active) return accent ?? "#00ff88";
  return "#737373";
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

        <nav className="hidden items-center gap-1.5 sm:gap-2 md:gap-4 xl:flex" aria-label="Main navigation">
          {DESKTOP_NAV.map((item) => {
            const active = isActivePath(pathname, item.href);
            const color = navColor(active, item.accent);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-1 text-[11px] font-bold transition-colors whitespace-nowrap"
                style={{ color, letterSpacing: "0.05em", fontFamily: "monospace" }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = item.accent ?? "#00ff88")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = color)}
                aria-current={active ? "page" : undefined}
              >
                {item.label.toUpperCase()}
                {item.badge ? (
                  <span
                    className="px-1 py-0.5 rounded text-center"
                    style={{
                      fontSize: 10,
                      background: `${item.accent ?? "#00ff88"}1f`,
                      border: `1px solid ${item.accent ?? "#00ff88"}55`,
                      color: item.accent ?? "#00ff88",
                      fontFamily: "monospace",
                      letterSpacing: "0.06em",
                      lineHeight: 1,
                    }}
                  >
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}

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
          Rush ecosystem online
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
