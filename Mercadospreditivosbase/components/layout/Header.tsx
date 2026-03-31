"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sun, Moon } from "lucide-react";
import { WalletButton } from "@/components/layout/WalletButton";
import { useTheme } from "@/hooks/useTheme";

const navLinks = [
  { href: "/markets", label: "MARKETS" },
  { href: "/markets?sort=most-volume", label: "HOT", matchHref: "/markets" },
] as const;

export default function Header() {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();

  return (
    <header
      className="glass sticky top-0 z-50"
      style={{ borderBottom: "1px solid var(--border)" }}
    >
      <div
        className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between"
      >
        {/* Left: Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 shrink-0"
          aria-label="Rush Markets — Home"
          style={{ filter: "drop-shadow(0 0 8px rgba(0,255,136,0.35))" }}
        >
          <img src="/logo.png" alt="Rush Markets" className="h-8 w-auto" />
        </Link>

        {/* Center: Nav links (desktop) */}
        <nav
          className="hidden md:flex items-center gap-6"
          aria-label="Main navigation"
        >
          {navLinks.map(({ href, label, ...rest }) => {
            const matchHref = (rest as { matchHref?: string }).matchHref ?? href;
            const isActive = pathname === matchHref || pathname.startsWith(matchHref + "/");
            return (
              <Link
                key={label}
                href={href}
                className="text-xs uppercase tracking-widest transition-colors"
                style={{
                  fontFamily: "monospace",
                  color: isActive ? "var(--primary)" : "var(--muted)",
                  textShadow: isActive ? "0 0 8px rgba(0,255,136,0.4)" : "none",
                  fontWeight: isActive ? 700 : 500,
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLElement).style.color = "var(--text)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLElement).style.color = "var(--muted)";
                  }
                }}
              >
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Center-right: Live indicator (large screens) */}
        <div
          className="hidden lg:flex items-center gap-2 text-xs"
          style={{ color: "var(--muted)" }}
          aria-hidden="true"
        >
          <span className="live-dot" />
          <span style={{ fontFamily: "monospace", letterSpacing: "0.1em" }}>LIVE</span>
        </div>

        {/* Right: Theme toggle + Wallet */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Mobile: live indicator */}
          <div
            className="flex md:hidden items-center gap-1.5"
            aria-hidden="true"
          >
            <span className="live-dot" />
          </div>
          <button
            onClick={toggleTheme}
            className="p-2 rounded-md transition-colors"
            style={{
              color: "var(--muted)",
              background: "transparent",
            }}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
