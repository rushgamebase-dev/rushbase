"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { useAccount } from "wagmi";
import Header from "@/components/Header";
import { ProfilePage } from "@/profile-kit/pages/ProfilePage";
import { ProfileEditor } from "@/profile-kit/components/profile/ProfileEditor";
import { useAuth } from "@/profile-kit/hooks/useAuth";
import { useMyProfile } from "@/profile-kit/hooks/useMyProfile";

export default function MyProfileRoute() {
  const { isConnected } = useAccount();
  const { isAuthenticated, signIn, signOut, isSigningIn } = useAuth();
  const { profile, isLoading, updateProfile } = useMyProfile();
  const [editing, setEditing] = useState(false);
  const [forcedFirstTime, setForcedFirstTime] = useState(false);

  const hasHandle = !!profile?.profile?.handle;
  const isFirstTime = !!profile && !hasHandle;

  // Auto-open editor on first login
  useEffect(() => {
    if (isFirstTime && !forcedFirstTime && !editing) {
      setEditing(true);
      setForcedFirstTime(true);
    }
  }, [isFirstTime, forcedFirstTime, editing]);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#0a0a0a", color: "#e0e0e0" }}>
      <Header />
      <main className="flex-1 p-4 md:p-8 max-w-4xl mx-auto w-full">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/" className="flex items-center gap-1.5 text-xs hover:text-[#00ff88] transition-colors" style={{ color: "#555", fontFamily: "monospace" }}>
            <ArrowLeft size={13} /> BACK
          </Link>
          <span style={{ color: "#333" }}>/</span>
          <span className="text-sm font-bold tracking-widest" style={{ color: "#e0e0e0", fontFamily: "monospace" }}>MY PROFILE</span>
        </div>

        {!isConnected && (
          <div className="max-w-md mx-auto text-center py-16 space-y-3">
            <div className="text-4xl mb-2">🎯</div>
            <div className="text-lg font-mono font-bold text-[#e0e0e0]">Connect a wallet</div>
            <div className="text-sm font-mono text-[#666]">
              Your wallet is your profile. One click up-right to start.
            </div>
          </div>
        )}

        {isConnected && !isAuthenticated && (
          <div className="max-w-md mx-auto text-center py-16 space-y-4">
            <div className="text-4xl mb-2">✍️</div>
            <div className="text-lg font-mono font-bold text-[#e0e0e0]">Sign in to unlock your profile</div>
            <div className="text-xs font-mono text-[#666] max-w-xs mx-auto">
              One signature, off-chain. Claims wallet ownership so you can set a handle, avatar, and track stats.
            </div>
            <button onClick={() => signIn().catch(() => {})} disabled={isSigningIn}
              className="bg-[#00ff88] text-black font-mono font-bold py-2.5 px-6 rounded-lg hover:bg-[#00ff88]/90 transition-colors disabled:opacity-50 shadow-[0_0_18px_rgba(0,255,136,0.3)]">
              {isSigningIn ? "Opening wallet..." : "Sign in with wallet"}
            </button>
          </div>
        )}

        {isConnected && isAuthenticated && isLoading && (
          <div className="max-w-3xl mx-auto space-y-4 animate-pulse">
            <div className="h-64 bg-[#0d0d0d] border border-[#1a1a1a] rounded-xl" />
            <div className="h-32 bg-[#0d0d0d] border border-[#1a1a1a] rounded-xl" />
          </div>
        )}

        {/* Read mode */}
        {isConnected && isAuthenticated && profile && !editing && (
          <>
            <ProfilePage handle={profile.wallet} isOwnProfile onEditClick={() => setEditing(true)} />
            <div className="max-w-3xl mx-auto mt-6 text-right">
              <button onClick={signOut} className="text-xs font-mono text-[#666] hover:text-[#ff4444] transition-colors">
                Sign out
              </button>
            </div>
          </>
        )}

        {/* Edit mode */}
        {isConnected && isAuthenticated && profile && editing && (
          <div className="max-w-lg mx-auto">
            {isFirstTime ? (
              <div
                className="rounded-xl p-5 mb-6 text-center"
                style={{
                  background: 'radial-gradient(circle at 50% 0%, rgba(0,255,136,0.12), transparent 70%), #0d0d0d',
                  border: '1px solid rgba(0,255,136,0.25)',
                }}
              >
                <div className="flex items-center justify-center gap-2 text-[#00ff88] font-mono font-bold text-sm">
                  <Sparkles size={16} /> Set up your profile
                </div>
                <div className="mt-2 text-xs font-mono text-[#aaa] max-w-sm mx-auto">
                  Pick a handle + avatar in 30 seconds. This is how other players will see you in chat, leaderboards, and bet toasts.
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-mono font-bold text-[#e0e0e0]">Edit profile</h2>
                <button onClick={() => setEditing(false)} className="text-xs font-mono text-[#666] hover:text-[#00ff88] transition-colors">
                  Cancel
                </button>
              </div>
            )}

            <ProfileEditor profile={profile} isSaving={updateProfile.isPending}
              onSave={async (updates) => {
                await updateProfile.mutateAsync(updates);
                setEditing(false);
              }} />

            {isFirstTime && (
              <div className="text-center mt-5">
                <button
                  onClick={() => setEditing(false)}
                  className="text-[11px] font-mono text-[#555] hover:text-[#aaa] transition-colors"
                >
                  Skip for now
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
