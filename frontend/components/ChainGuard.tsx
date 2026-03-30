"use client";

import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { base } from "wagmi/chains";

/**
 * Full-screen overlay that blocks all interaction when connected to wrong chain.
 * Forces switch to Base before anything can happen.
 */
export default function ChainGuard() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  if (!isConnected || chainId === base.id) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{
        background: "rgba(0,0,0,0.92)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div
        className="flex flex-col items-center gap-4 p-8 rounded-2xl max-w-sm mx-4 text-center"
        style={{
          background: "#111",
          border: "1px solid rgba(255,68,68,0.3)",
          boxShadow: "0 0 40px rgba(255,68,68,0.1)",
        }}
      >
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center"
          style={{ background: "rgba(255,68,68,0.1)", border: "1px solid rgba(255,68,68,0.3)" }}
        >
          <span style={{ fontSize: 24 }}>!</span>
        </div>

        <div>
          <div
            className="text-sm font-black tracking-widest mb-1"
            style={{ color: "#ff4444", fontFamily: "monospace" }}
          >
            WRONG NETWORK
          </div>
          <div className="text-xs" style={{ color: "#666", fontFamily: "monospace" }}>
            Rush runs on Base. Please switch your wallet to continue.
          </div>
        </div>

        <button
          onClick={() => switchChain?.({ chainId: base.id })}
          className="w-full py-3 rounded-lg text-sm font-black tracking-wider transition-all"
          style={{
            background: "linear-gradient(180deg, rgba(0,255,136,0.15), rgba(0,255,136,0.08))",
            border: "1px solid rgba(0,255,136,0.3)",
            color: "#00ff88",
            fontFamily: "monospace",
            cursor: "pointer",
          }}
        >
          SWITCH TO BASE
        </button>

        <div className="text-[10px]" style={{ color: "#333", fontFamily: "monospace" }}>
          Do NOT send ETH from Ethereum mainnet.
          <br />
          Base network only.
        </div>
      </div>
    </div>
  );
}
