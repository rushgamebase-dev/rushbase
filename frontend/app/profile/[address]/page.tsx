"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import Header from "@/components/Header";
import { ProfilePage } from "@/profile-kit/pages/ProfilePage";

export default function ProfilePageRoute({ params }: { params: { address: string } }) {
  const { address } = params;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#0a0a0a", color: "#e0e0e0" }}>
      <Header />
      <main className="flex-1 p-4 md:p-8 max-w-4xl mx-auto w-full">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/" className="flex items-center gap-1.5 text-xs transition-colors hover:text-[#00ff88]" style={{ color: "#555", fontFamily: "monospace" }}>
            <ArrowLeft size={13} /> BACK
          </Link>
          <span style={{ color: "#333" }}>/</span>
          <span className="text-sm font-bold tracking-widest" style={{ color: "#e0e0e0", fontFamily: "monospace" }}>PROFILE</span>
        </div>
        <ProfilePage handle={address} />
      </main>
    </div>
  );
}
