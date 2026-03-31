"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useBalance,
  useSwitchChain,
  useChainId,
} from "wagmi";
import { injected, coinbaseWallet } from "wagmi/connectors";
import { base } from "wagmi/chains";
import { formatEther } from "viem";

// ---------------------------------------------------------------------------
// Wallet icons — inline SVGs, no external deps
// ---------------------------------------------------------------------------

function MetaMaskIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 142 136.878"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path fill="#FF5C16" d="M132.682,132.192l-30.583-9.106l-23.063,13.787l-16.092-0.007l-23.077-13.78l-30.569,9.106L0,100.801l9.299-34.839L0,36.507L9.299,0l47.766,28.538h27.85L132.682,0l9.299,36.507l-9.299,29.455l9.299,34.839L132.682,132.192z" />
      <path fill="#FF5C16" d="M9.305,0l47.767,28.558l-1.899,19.599L9.305,0z M39.875,100.814l21.017,16.01l-21.017,6.261C39.875,123.085,39.875,100.814,39.875,100.814z M59.212,74.345l-4.039-26.174L29.317,65.97l-0.014-0.007v0.013l0.08,18.321l10.485-9.951L59.212,74.345z M132.682,0L84.915,28.558l1.893,19.599L132.682,0z M102.113,100.814l-21.018,16.01l21.018,6.261V100.814z M112.678,65.975h0.007v-0.013l-0.006,0.007L86.815,48.171l-4.039,26.174h19.336l10.492,9.95C112.604,84.295,112.678,65.975,112.678,65.975z" />
      <path fill="#E34807" d="M39.868,123.085l-30.569,9.106L0,100.814h39.868C39.868,100.814,39.868,123.085,39.868,123.085z M59.205,74.338l5.839,37.84l-8.093-21.04L29.37,84.295l10.491-9.956h19.344z M102.112,123.085l30.57,9.106l9.299-31.378h-39.869C102.112,100.814,102.112,123.085,102.112,123.085z M82.776,74.338l-5.839,37.84l8.092-21.04l27.583-6.843l-10.498-9.956H82.776V74.338z" />
      <path fill="#FF8D5D" d="M0,100.801l9.299-34.839h19.997l0.073,18.327l27.584,6.843l8.092,21.039l-4.16,4.633l-21.017-16.01H0V100.801z M141.981,100.801l-9.299-34.839h-19.998l-0.073,18.327l-27.582,6.843l-8.093,21.039l4.159,4.633l21.018-16.01h39.868V100.801z M84.915,28.538h-27.85l-1.891,19.599l9.872,64.013h11.891l9.878-64.013L84.915,28.538z" />
      <path fill="#661800" d="M9.299,0L0,36.507l9.299,29.455h19.997l25.87-17.804L9.299,0z M53.426,81.938h-9.059l-4.932,4.835l17.524,4.344l-3.533-9.186V81.938z M132.682,0l9.299,36.507l-9.299,29.455h-19.998L86.815,48.158L132.682,0z M88.568,81.938h9.072l4.932,4.841l-17.544,4.353l3.54-9.201V81.938z M79.029,124.385l2.067-7.567l-4.16-4.633h-11.9l-4.159,4.633l2.066,7.567" />
      <path fill="#C0C4CD" d="M79.029,124.384v12.495H62.945v-12.495H79.029z" />
      <path fill="#E7EBF6" d="M39.875,123.072l23.083,13.8v-12.495l-2.067-7.566C60.891,116.811,39.875,123.072,39.875,123.072z M102.113,123.072l-23.084,13.8v-12.495l2.067-7.566C81.096,116.811,102.113,123.072,102.113,123.072z" />
    </svg>
  );
}

function PhantomIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect width="128" height="128" fill="#AB9FF2" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M55.6416 82.1477C50.8744 89.4525 42.8862 98.6966 32.2568 98.6966C27.232 98.6966 22.4004 96.628 22.4004 87.6424C22.4004 64.7584 53.6445 29.3335 82.6339 29.3335C99.1257 29.3335 105.697 40.7755 105.697 53.7689C105.697 70.4471 94.8739 89.5171 84.1156 89.5171C80.7013 89.5171 79.0264 87.6424 79.0264 84.6688C79.0264 83.8931 79.1552 83.0527 79.4129 82.1477C75.7409 88.4182 68.6546 94.2361 62.0192 94.2361C57.1877 94.2361 54.7397 91.1979 54.7397 86.9314C54.7397 85.3799 55.0618 83.7638 55.6416 82.1477ZM80.6133 53.3182C80.6133 57.1044 78.3795 58.9975 75.8806 58.9975C73.3438 58.9975 71.1479 57.1044 71.1479 53.3182C71.1479 49.532 73.3438 47.6389 75.8806 47.6389C78.3795 47.6389 80.6133 49.532 80.6133 53.3182ZM94.8102 53.3184C94.8102 57.1046 92.5763 58.9977 90.0775 58.9977C87.5407 58.9977 85.3447 57.1046 85.3447 53.3184C85.3447 49.5323 87.5407 47.6392 90.0775 47.6392C92.5763 47.6392 94.8102 49.5323 94.8102 53.3184Z"
        fill="#FFFDF8"
      />
    </svg>
  );
}

function CoinbaseIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect width="128" height="128" rx="26" fill="#0052FF" />
      <circle cx="64" cy="64" r="42" fill="#fff" />
      <rect x="48" y="48" width="32" height="32" rx="6" fill="#0052FF" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Copy icon (no lucide dep for this package)
// ---------------------------------------------------------------------------

function IconCopy({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function IconExternal({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function IconLogOut({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function IconChevron({ size = 12, flipped = false }: { size?: number; flipped?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ transform: flipped ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function IconX({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Wallet Modal
// ---------------------------------------------------------------------------

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function WalletModal({ isOpen, onClose }: WalletModalProps) {
  const { connect, connectors, isPending } = useConnect();
  const [connectingId, setConnectingId] = useState<string | null>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (isOpen) {
      document.addEventListener("keydown", handleKey);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [isOpen, onClose]);

  async function handleConnect(optionId: string) {
    setConnectingId(optionId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w: any = typeof window !== "undefined" ? window : {};

    let connector = connectors[0]; // fallback

    if (optionId === "coinbaseWallet") {
      connector = connectors.find((c) => c.id === "coinbaseWallet") ?? connector;
    } else if (optionId === "injected-phantom") {
      const hasPhantom = !!w.phantom?.ethereum;
      if (!hasPhantom) {
        window.open("https://phantom.app/", "_blank");
        setConnectingId(null);
        return;
      }
      try {
        if (w.phantom?.ethereum) {
          await w.phantom.ethereum.request({ method: "eth_requestAccounts" });
        }
      } catch {
        // user rejected
      }
      connector = connectors.find((c) => c.id === "injected") ?? connector;
    } else {
      // MetaMask
      const hasMetaMask = !!w.ethereum?.isMetaMask;
      if (!hasMetaMask) {
        window.open("https://metamask.io/download/", "_blank");
        setConnectingId(null);
        return;
      }
      connector = connectors.find((c) => c.id === "injected") ?? connector;
    }

    try {
      connect({ connector });
      onClose();
    } catch {
      // cancelled or failed
    }

    setConnectingId(null);
  }

  if (!isOpen) return null;

  const walletOptions = [
    {
      id: "injected-metamask",
      name: "MetaMask",
      icon: <MetaMaskIcon size={32} />,
      description: "Connect using MetaMask browser extension",
    },
    {
      id: "injected-phantom",
      name: "Phantom",
      icon: <PhantomIcon size={32} />,
      description: "Connect using Phantom wallet",
    },
    {
      id: "coinbaseWallet",
      name: "Coinbase Wallet",
      icon: <CoinbaseIcon size={32} />,
      description: "Connect using Coinbase Wallet",
    },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Connect Wallet"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(0,0,0,0.78)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="animate-fade-in-up w-full"
        style={{
          maxWidth: 360,
          background: "#111",
          border: "1px solid rgba(0,255,136,0.2)",
          borderRadius: 12,
          boxShadow: "0 0 40px rgba(0,255,136,0.07), 0 24px 48px rgba(0,0,0,0.65)",
        }}
      >
        {/* Modal header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid #1a1a1a" }}
        >
          <div>
            <p
              className="text-sm font-black tracking-widest"
              style={{ color: "#e0e0e0", fontFamily: "monospace" }}
            >
              CONNECT WALLET
            </p>
            <p className="text-xs mt-0.5" style={{ color: "#555" }}>
              Choose your wallet to get started
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close wallet modal"
            style={{
              width: 28,
              height: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "50%",
              background: "#1a1a1a",
              border: "none",
              color: "#666",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "#aaa")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "#666")}
          >
            <IconX size={14} />
          </button>
        </div>

        {/* Wallet options */}
        <div className="p-4 flex flex-col gap-2">
          {walletOptions.map((option) => {
            const isConnecting = isPending && connectingId === option.id;
            return (
              <button
                key={option.id}
                onClick={() => handleConnect(option.id)}
                disabled={isPending}
                className="flex items-center gap-4 px-4 py-3.5 rounded-lg text-left transition-all"
                style={{
                  background: "#0d0d0d",
                  border: "1px solid #1a1a1a",
                  cursor: isPending ? "wait" : "pointer",
                  opacity: isPending && connectingId !== option.id ? 0.5 : 1,
                  width: "100%",
                }}
                onMouseEnter={(e) => {
                  if (!isPending) {
                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,255,136,0.3)";
                    (e.currentTarget as HTMLElement).style.background = "#141414";
                  }
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = "#1a1a1a";
                  (e.currentTarget as HTMLElement).style.background = "#0d0d0d";
                }}
              >
                <span className="shrink-0">{option.icon}</span>
                <span className="flex-1 min-w-0">
                  <span
                    className="block text-sm font-bold"
                    style={{ color: "#e0e0e0", fontFamily: "monospace" }}
                  >
                    {option.name}
                  </span>
                  <span className="block text-xs mt-0.5" style={{ color: "#555" }}>
                    {option.description}
                  </span>
                </span>
                {isConnecting && (
                  <span
                    className="shrink-0"
                    aria-label="Connecting..."
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      border: "2px solid rgba(0,255,136,0.4)",
                      borderTopColor: "transparent",
                      display: "inline-block",
                      animation: "spin 0.7s linear infinite",
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <p
          className="px-5 py-3 text-xs text-center"
          style={{ borderTop: "1px solid #1a1a1a", color: "#333" }}
        >
          By connecting you agree to the{" "}
          <span style={{ color: "#555" }}>terms of service</span>
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connected dropdown
// ---------------------------------------------------------------------------

interface AccountDropdownProps {
  address: `0x${string}`;
  onDisconnect: () => void;
  onClose: () => void;
}

function AccountDropdown({ address, onDisconnect, onClose }: AccountDropdownProps) {
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [onClose]);

  function copyAddress() {
    navigator.clipboard.writeText(address).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const items = [
    {
      label: copied ? "Copied!" : "Copy Address",
      icon: <IconCopy size={13} />,
      onClick: copyAddress,
      color: copied ? "#00ff88" : "#aaa",
    },
    {
      label: "View on Basescan",
      icon: <IconExternal size={13} />,
      onClick: () => window.open(`https://basescan.org/address/${address}`, "_blank"),
      color: "#aaa",
    },
    {
      label: "Disconnect",
      icon: <IconLogOut size={13} />,
      onClick: () => {
        onDisconnect();
        onClose();
      },
      color: "#ff4444",
    },
  ];

  return (
    <div
      ref={ref}
      className="animate-fade-in-up"
      role="menu"
      style={{
        position: "absolute",
        right: 0,
        top: "calc(100% + 8px)",
        width: 200,
        background: "#111",
        border: "1px solid #2a2a2a",
        borderRadius: 8,
        boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        overflow: "hidden",
        zIndex: 50,
      }}
    >
      {items.map((item, i) => (
        <button
          key={item.label}
          onClick={item.onClick}
          role="menuitem"
          className="w-full flex items-center gap-3 px-4 py-2.5 text-xs transition-colors text-left"
          style={{
            color: item.color,
            fontFamily: "monospace",
            background: "transparent",
            border: "none",
            borderTop: i > 0 ? "1px solid #1a1a1a" : "none",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "#1a1a1a")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main WalletButton
// ---------------------------------------------------------------------------

export function WalletButton() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { data: balanceData } = useBalance({ address });
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  const isWrongChain = isConnected && chainId !== base.id;

  const [modalOpen, setModalOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const openModal = useCallback(() => setModalOpen(true), []);
  const closeModal = useCallback(() => setModalOpen(false), []);
  const closeDropdown = useCallback(() => setDropdownOpen(false), []);

  // Auto-switch to Base when on wrong chain
  useEffect(() => {
    if (isWrongChain && switchChain) {
      switchChain({ chainId: base.id });
    }
  }, [isWrongChain, switchChain]);

  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : "";

  const ethBalance =
    balanceData ? parseFloat(formatEther(balanceData.value)).toFixed(4) : null;

  if (isWrongChain) {
    return (
      <>
        <button
          onClick={() => switchChain?.({ chainId: base.id })}
          aria-label="Switch to Base network"
          className="text-xs font-bold tracking-wider animate-pulse"
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            background: "rgba(255,68,68,0.15)",
            border: "1px solid rgba(255,68,68,0.4)",
            color: "#ff4444",
            fontFamily: "monospace",
            cursor: "pointer",
          }}
        >
          SWITCH TO BASE
        </button>
        <WalletModal isOpen={modalOpen} onClose={closeModal} />
      </>
    );
  }

  if (!isConnected) {
    return (
      <>
        <button
          onClick={openModal}
          aria-label="Connect Wallet"
          className="text-xs font-bold tracking-wider transition-all"
          style={{
            padding: "6px 14px",
            borderRadius: 6,
            background: "rgba(0,255,136,0.1)",
            border: "1px solid rgba(0,255,136,0.3)",
            color: "#00ff88",
            fontFamily: "monospace",
            letterSpacing: "0.08em",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "rgba(0,255,136,0.18)";
            (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,255,136,0.5)";
            (e.currentTarget as HTMLElement).style.boxShadow = "0 0 16px rgba(0,255,136,0.15)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "rgba(0,255,136,0.1)";
            (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,255,136,0.3)";
            (e.currentTarget as HTMLElement).style.boxShadow = "";
          }}
        >
          CONNECT
        </button>
        <WalletModal isOpen={modalOpen} onClose={closeModal} />
      </>
    );
  }

  return (
    <>
      <div style={{ position: "relative" }}>
        <button
          onClick={() => setDropdownOpen((d) => !d)}
          aria-label="Wallet menu"
          aria-expanded={dropdownOpen}
          aria-haspopup="menu"
          className="flex items-center gap-2 text-xs font-bold transition-all"
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            background: "#111",
            border: "1px solid #2a2a2a",
            color: "#e0e0e0",
            fontFamily: "monospace",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.borderColor = "#3a3a3a")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.borderColor = "#2a2a2a")}
        >
          {/* Connected dot */}
          <span
            aria-hidden="true"
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "#00ff88",
              boxShadow: "0 0 6px rgba(0,255,136,0.7)",
              flexShrink: 0,
              display: "inline-block",
            }}
          />
          <span style={{ color: "#00ff88" }}>{shortAddress}</span>
          {ethBalance !== null && (
            <span style={{ color: "#555" }}>{ethBalance} ETH</span>
          )}
          <IconChevron size={12} flipped={dropdownOpen} />
        </button>

        {dropdownOpen && (
          <AccountDropdown
            address={address!}
            onDisconnect={disconnect}
            onClose={closeDropdown}
          />
        )}
      </div>

      <WalletModal isOpen={modalOpen} onClose={closeModal} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Hook to open the wallet modal from other components
// ---------------------------------------------------------------------------

export function useWalletModal() {
  const [isOpen, setIsOpen] = useState(false);
  return {
    isOpen,
    open: useCallback(() => setIsOpen(true), []),
    close: useCallback(() => setIsOpen(false), []),
  };
}
