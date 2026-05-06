"use client";

import { useEffect, ReactNode } from "react";
import { usePathname } from "next/navigation";
import Cookies from "js-cookie";
import { Header } from "@/components/layout/header";
import { MobileNav } from "@/components/layout/mobile-nav";
import { Providers } from "@/app/providers";
import { useAuth } from "@/stores";

function AutoLogin({ children }: { children: ReactNode }) {
  const { login, isAuthenticated } = useAuth();

  useEffect(() => {
    const autoLogin = async () => {
      const token = Cookies.get("accessToken");
      if (!token && !isAuthenticated) {
        try {
          await login("demo@test.com", "demo123456");
          console.log("Auto-logged in with demo account");
        } catch (e) {
          console.log("Auto-login failed:", e);
        }
      }
    };
    autoLogin();
  }, [login, isAuthenticated]);

  return <>{children}</>;
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isTradeFullscreen = pathname === "/trade";

  return (
    <Providers>
      <AutoLogin>
        {isTradeFullscreen ? (
          // Fullscreen immersive mode for trade
          <>{children}</>
        ) : (
          // Normal layout with header for other pages
          <div className="min-h-screen bg-background flex flex-col">
            <Header />
            <main className="flex-1 pb-20 md:pb-0">{children}</main>
            <MobileNav />
          </div>
        )}
      </AutoLogin>
    </Providers>
  );
}
