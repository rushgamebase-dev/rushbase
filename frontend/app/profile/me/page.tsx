"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
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
          <div className="text-center py-16 text-sm font-mono text-[#666666]">
            Conecte a wallet pra ver seu perfil.
          </div>
        )}

        {isConnected && !isAuthenticated && (
          <div className="text-center py-16 space-y-4">
            <div className="text-sm font-mono text-[#666666]">Entre com sua wallet pra gerenciar o perfil.</div>
            <button onClick={() => signIn().catch(() => {})} disabled={isSigningIn}
              className="bg-[#00ff88] text-black font-mono font-bold py-2 px-6 rounded-lg hover:bg-[#00ff88]/90 transition-colors disabled:opacity-50">
              {isSigningIn ? "Assinando..." : "Sign in"}
            </button>
          </div>
        )}

        {isConnected && isAuthenticated && isLoading && (
          <div className="text-center py-16 text-sm font-mono text-[#666666]">Carregando…</div>
        )}

        {isConnected && isAuthenticated && profile && !editing && (
          <>
            <ProfilePage handle={profile.wallet} isOwnProfile onEditClick={() => setEditing(true)} />
            <div className="max-w-3xl mx-auto mt-6 text-right">
              <button onClick={signOut} className="text-xs font-mono text-[#666666] hover:text-[#ff4444] transition-colors">
                Sign out
              </button>
            </div>
          </>
        )}

        {isConnected && isAuthenticated && profile && editing && (
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-mono font-bold text-[#e0e0e0]">Editar perfil</h2>
              <button onClick={() => setEditing(false)} className="text-xs font-mono text-[#666666] hover:text-[#00ff88] transition-colors">
                Cancelar
              </button>
            </div>
            <ProfileEditor profile={profile} isSaving={updateProfile.isPending}
              onSave={async (updates) => {
                await updateProfile.mutateAsync(updates);
                setEditing(false);
              }} />
          </div>
        )}
      </main>
    </div>
  );
}
