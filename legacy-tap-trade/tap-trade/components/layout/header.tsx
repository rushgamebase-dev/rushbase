"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Wallet, LogOut, Settings, User, LineChart, History, Trophy } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { useAuth, useBalance } from "@/stores";
import { Button } from "@/components/ui/button";
import { StreakDisplay } from "@/components/gamification/streak-display";

const NAV_ITEMS = [
  { href: "/trade", label: "Trade", icon: LineChart },
  { href: "/dashboard", label: "Dashboard", icon: User },
  { href: "/history", label: "History", icon: History },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
];

export function Header() {
  const pathname = usePathname();
  const { user, logout, isAuthenticated } = useAuth();
  const { balance } = useBalance();

  return (
    <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-border safe-top">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/trade" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-400 to-accent-purple flex items-center justify-center">
              <span className="font-bold text-white text-sm">T</span>
            </div>
            <span className="font-bold text-lg text-text-primary hidden sm:block">TapTrading</span>
          </Link>

          {/* Navigation */}
          {isAuthenticated && (
            <nav className="hidden md:flex items-center gap-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                  <Link key={item.href} href={item.href}>
                    <motion.div
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-lg transition-colors",
                        isActive
                          ? "bg-primary-500/20 text-primary-400"
                          : "text-text-secondary hover:bg-background-elevated hover:text-text-primary"
                      )}
                    >
                      <Icon className="w-4 h-4" />
                      <span className="text-sm font-medium">{item.label}</span>
                    </motion.div>
                  </Link>
                );
              })}
            </nav>
          )}

          {/* Right side */}
          <div className="flex items-center gap-3">
            {isAuthenticated ? (
              <>
                <StreakDisplay />

                {/* Balance */}
                <div className="flex items-center gap-2 bg-background-secondary rounded-lg px-3 py-2">
                  <Wallet className="w-4 h-4 text-primary-400" />
                  <span className="font-semibold text-text-primary">
                    {formatCurrency(balance.availableBalance)}
                  </span>
                </div>

                {/* Settings */}
                <Link href="/settings">
                  <Button variant="ghost" size="icon">
                    <Settings className="w-5 h-5" />
                  </Button>
                </Link>

                {/* Logout */}
                <Button variant="ghost" size="icon" onClick={logout}>
                  <LogOut className="w-5 h-5" />
                </Button>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <Link href="/login">
                  <Button variant="ghost">Login</Button>
                </Link>
                <Link href="/register">
                  <Button>Sign Up</Button>
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
