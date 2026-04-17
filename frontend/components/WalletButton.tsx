"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAccount, useConnect, useDisconnect, useBalance, useSwitchChain } from "wagmi";
import { base } from "wagmi/chains";
import { formatEther } from "viem";
import { Copy, LogOut, ExternalLink, ChevronDown, X, RefreshCw, Plus, User } from "lucide-react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";

// ---------------------------------------------------------------------------
// Wallet icons — inline SVGs so no external deps needed
// ---------------------------------------------------------------------------

function MetaMaskIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 142 136.878" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path fill="#FF5C16" d="M132.682,132.192l-30.583-9.106l-23.063,13.787l-16.092-0.007l-23.077-13.78l-30.569,9.106L0,100.801l9.299-34.839L0,36.507L9.299,0l47.766,28.538h27.85L132.682,0l9.299,36.507l-9.299,29.455l9.299,34.839L132.682,132.192z"/>
      <path fill="#FF5C16" d="M9.305,0l47.767,28.558l-1.899,19.599L9.305,0z M39.875,100.814l21.017,16.01l-21.017,6.261C39.875,123.085,39.875,100.814,39.875,100.814z M59.212,74.345l-4.039-26.174L29.317,65.97l-0.014-0.007v0.013l0.08,18.321l10.485-9.951L59.212,74.345z M132.682,0L84.915,28.558l1.893,19.599L132.682,0z M102.113,100.814l-21.018,16.01l21.018,6.261V100.814z M112.678,65.975h0.007v-0.013l-0.006,0.007L86.815,48.171l-4.039,26.174h19.336l10.492,9.95C112.604,84.295,112.678,65.975,112.678,65.975z"/>
      <path fill="#E34807" d="M39.868,123.085l-30.569,9.106L0,100.814h39.868C39.868,100.814,39.868,123.085,39.868,123.085z M59.205,74.338l5.839,37.84l-8.093-21.04L29.37,84.295l10.491-9.956h19.344z M102.112,123.085l30.57,9.106l9.299-31.378h-39.869C102.112,100.814,102.112,123.085,102.112,123.085z M82.776,74.338l-5.839,37.84l8.092-21.04l27.583-6.843l-10.498-9.956H82.776V74.338z"/>
      <path fill="#FF8D5D" d="M0,100.801l9.299-34.839h19.997l0.073,18.327l27.584,6.843l8.092,21.039l-4.16,4.633l-21.017-16.01H0V100.801z M141.981,100.801l-9.299-34.839h-19.998l-0.073,18.327l-27.582,6.843l-8.093,21.039l4.159,4.633l21.018-16.01h39.868V100.801z M84.915,28.538h-27.85l-1.891,19.599l9.872,64.013h11.891l9.878-64.013L84.915,28.538z"/>
      <path fill="#661800" d="M9.299,0L0,36.507l9.299,29.455h19.997l25.87-17.804L9.299,0z M53.426,81.938h-9.059l-4.932,4.835l17.524,4.344l-3.533-9.186V81.938z M132.682,0l9.299,36.507l-9.299,29.455h-19.998L86.815,48.158L132.682,0z M88.568,81.938h9.072l4.932,4.841l-17.544,4.353l3.54-9.201V81.938z M79.029,124.385l2.067-7.567l-4.16-4.633h-11.9l-4.159,4.633l2.066,7.567"/>
      <path fill="#C0C4CD" d="M79.029,124.384v12.495H62.945v-12.495H79.029z"/>
      <path fill="#E7EBF6" d="M39.875,123.072l23.083,13.8v-12.495l-2.067-7.566C60.891,116.811,39.875,123.072,39.875,123.072z M102.113,123.072l-23.084,13.8v-12.495l2.067-7.566C81.096,116.811,102.113,123.072,102.113,123.072z"/>
    </svg>
  );
}

function PhantomIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="128" height="128" fill="#AB9FF2"/>
      <path fillRule="evenodd" clipRule="evenodd" d="M55.6416 82.1477C50.8744 89.4525 42.8862 98.6966 32.2568 98.6966C27.232 98.6966 22.4004 96.628 22.4004 87.6424C22.4004 64.7584 53.6445 29.3335 82.6339 29.3335C99.1257 29.3335 105.697 40.7755 105.697 53.7689C105.697 70.4471 94.8739 89.5171 84.1156 89.5171C80.7013 89.5171 79.0264 87.6424 79.0264 84.6688C79.0264 83.8931 79.1552 83.0527 79.4129 82.1477C75.7409 88.4182 68.6546 94.2361 62.0192 94.2361C57.1877 94.2361 54.7397 91.1979 54.7397 86.9314C54.7397 85.3799 55.0618 83.7638 55.6416 82.1477ZM80.6133 53.3182C80.6133 57.1044 78.3795 58.9975 75.8806 58.9975C73.3438 58.9975 71.1479 57.1044 71.1479 53.3182C71.1479 49.532 73.3438 47.6389 75.8806 47.6389C78.3795 47.6389 80.6133 49.532 80.6133 53.3182ZM94.8102 53.3184C94.8102 57.1046 92.5763 58.9977 90.0775 58.9977C87.5407 58.9977 85.3447 57.1046 85.3447 53.3184C85.3447 49.5323 87.5407 47.6392 90.0775 47.6392C92.5763 47.6392 94.8102 49.5323 94.8102 53.3184Z" fill="#FFFDF8"/>
    </svg>
  );
}

function CoinbaseIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="128" height="128" rx="26" fill="#0052FF"/>
      <circle cx="64" cy="64" r="42" fill="#fff"/>
      <rect x="48" y="48" width="32" height="32" rx="6" fill="#0052FF"/>
    </svg>
  );
}

function RainbowIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="120" height="120" rx="24" fill="#001E59"/>
      <path d="M20 38h6c26.51 0 48 21.49 48 48v6h8v-6c0-30.928-25.072-56-56-56h-6v8z" fill="#FF4000"/>
      <path d="M20 54h6c17.673 0 32 14.327 32 32v6h8v-6c0-22.091-17.909-40-40-40h-6v8z" fill="#FF8000"/>
      <path d="M20 70h6c8.837 0 16 7.163 16 16v6h8v-6c0-13.255-10.745-24-24-24h-6v8z" fill="#FFC800"/>
      <path d="M20 86h6a0 0 0 0 1 0 0v6h8v-6c0-4.418-3.582-8-8-8h-6v8z" fill="#0AF"/>
      <path d="M20 86h6v6h-6z" fill="#2CFF00"/>
    </svg>
  );
}

function WalletConnectIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="128" height="128" rx="26" fill="#3B99FC"/>
      <path d="M40.2 50.2c13.1-12.8 34.3-12.8 47.4 0l1.6 1.5c.7.6.7 1.7 0 2.4l-5.3 5.2c-.3.3-.9.3-1.2 0l-2.2-2.1c-9.1-8.9-23.9-8.9-33.1 0l-2.3 2.3c-.3.3-.9.3-1.2 0l-5.3-5.2c-.7-.6-.7-1.7 0-2.4l1.6-1.7zm58.6 10.9l4.7 4.6c.7.6.7 1.7 0 2.4l-21.3 20.8c-.7.6-1.7.6-2.4 0L67.5 77c-.2-.2-.4-.2-.6 0L54.6 88.9c-.7.6-1.7.6-2.4 0L31 68.1c-.7-.6-.7-1.7 0-2.4l4.7-4.6c.7-.6 1.7-.6 2.4 0L50.4 73c.2.2.4.2.6 0l12.3-11.9c.7-.6 1.7-.6 2.4 0L78 73c.2.2.4.2.6 0l12.3-11.9c.6-.7 1.7-.7 2.3 0z" fill="#fff"/>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Wallet Modal
// ---------------------------------------------------------------------------

interface WalletOption {
  id: string;
  name: string;
  icon: React.ReactNode;
  description: string;
}

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function WalletModal({ isOpen, onClose }: WalletModalProps) {
  const { connect, connectors, isPending } = useConnect();
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Detect mobile
  const isMobile = typeof window !== "undefined" && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  // On mobile: prioritize wallets with deep-link / WalletConnect support
  // On desktop: show all options
  const walletOptions: WalletOption[] = isMobile
    ? [
        {
          id: "rainbow",
          name: "Rainbow",
          icon: <RainbowIcon size={32} />,
          description: "Open in Rainbow app",
        },
        {
          id: "walletConnect",
          name: "WalletConnect",
          icon: <WalletConnectIcon size={32} />,
          description: "Rainbow, Trust, and 300+ wallets",
        },
        {
          id: "coinbaseWallet",
          name: "Coinbase Wallet",
          icon: <CoinbaseIcon size={32} />,
          description: "Open in Coinbase Wallet app",
        },
        {
          id: "injected-metamask",
          name: "MetaMask",
          icon: <MetaMaskIcon size={32} />,
          description: "Open in MetaMask app",
        },
      ]
    : [
        {
          id: "injected-metamask",
          name: "MetaMask",
          icon: <MetaMaskIcon size={32} />,
          description: "Browser extension",
        },
        {
          id: "rainbow",
          name: "Rainbow",
          icon: <RainbowIcon size={32} />,
          description: "Via WalletConnect QR code",
        },
        {
          id: "injected-phantom",
          name: "Phantom",
          icon: <PhantomIcon size={32} />,
          description: "Browser extension",
        },
        {
          id: "coinbaseWallet",
          name: "Coinbase Wallet",
          icon: <CoinbaseIcon size={32} />,
          description: "Browser extension or app",
        },
        {
          id: "walletConnect",
          name: "Other Wallets",
          icon: <WalletConnectIcon size={32} />,
          description: "Trust, Zerion, Safe, and 300+ more",
        },
      ];

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
    const hasPhantom = !!w.phantom?.ethereum;
    const hasMetaMask = !!w.ethereum?.isMetaMask;
    const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    let connector = connectors[0]; // fallback

    if (optionId === "rainbow") {
      if (mobile) {
        // Deep-link into Rainbow app via WalletConnect
        const wcConnector = connectors.find((c) => c.id === "walletConnect");
        if (wcConnector) {
          connector = wcConnector;
        } else {
          // Fallback: open Rainbow download
          window.open("https://rainbow.me", "_blank");
          setConnectingId(null);
          return;
        }
      } else {
        // Desktop: WalletConnect QR — user scans with Rainbow mobile
        const wcConnector = connectors.find((c) => c.id === "walletConnect");
        if (wcConnector) {
          connector = wcConnector;
        }
      }
    } else if (optionId === "walletConnect") {
      connector = connectors.find((c) => c.id === "walletConnect") || connector;
    } else if (optionId === "coinbaseWallet") {
      connector = connectors.find((c) => c.id === "coinbaseWallet") || connector;
    } else if (optionId === "injected-phantom") {
      if (hasPhantom) {
        connector = connectors.find((c) => c.id === "injected") || connector;
        try {
          if (w.phantom?.ethereum) {
            await w.phantom.ethereum.request({ method: "eth_requestAccounts" });
          }
        } catch {}
      } else {
        window.open("https://phantom.app/", "_blank");
        setConnectingId(null);
        return;
      }
    } else {
      // MetaMask
      if (mobile && !hasMetaMask) {
        // On mobile without MetaMask: deep-link to MetaMask app
        window.location.href = `https://metamask.app.link/dapp/${window.location.host}${window.location.pathname}`;
        setConnectingId(null);
        return;
      }
      if (!mobile && !hasMetaMask) {
        window.open("https://metamask.io/download/", "_blank");
        setConnectingId(null);
        return;
      }
      connector = connectors.find((c) => c.id === "injected") || connector;
    }

    try {
      connect({ connector });
      onClose();
    } catch {
      // Connection cancelled or failed
    }

    setConnectingId(null);
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Overlay */}
          <motion.div
            ref={overlayRef}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 overflow-y-auto"
            style={{ background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, minHeight: "100vh" }}
            onClick={(e) => {
              if (e.target === e.currentTarget) onClose();
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Connect Wallet"
          >
            {/* Modal panel — bottom-sheet on mobile, centered on desktop */}
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="w-full max-w-sm rounded-xl"
              style={{
                background: "#111",
                border: "1px solid rgba(0,255,136,0.25)",
                boxShadow: "0 0 40px rgba(0,255,136,0.08), 0 24px 48px rgba(0,0,0,0.6)",
                margin: "auto",
                position: "relative",
                maxHeight: "85vh",
                overflowY: "auto",
              }}
            >
              {/* Header */}
              <div
                className="flex items-center justify-between px-5 py-4"
                style={{ borderBottom: "1px solid #1a1a1a" }}
              >
                <div>
                  <span
                    className="text-sm font-black tracking-widest"
                    style={{ color: "#e0e0e0", fontFamily: "monospace" }}
                  >
                    CONNECT WALLET
                  </span>
                  <p className="text-xs mt-0.5" style={{ color: "#555" }}>
                    Choose your wallet to get started
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="w-7 h-7 flex items-center justify-center rounded-full transition-colors"
                  style={{ color: "#555", background: "#1a1a1a", border: "none" }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "#aaa")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "#555")}
                  aria-label="Close wallet modal"
                >
                  <X size={14} />
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
                      className="flex items-center gap-4 px-4 py-4 rounded-lg text-left transition-all group"
                      style={{
                        background: "#0d0d0d",
                        border: "1px solid #1a1a1a",
                        cursor: isPending ? "wait" : "pointer",
                        opacity: isPending && connectingId !== option.id ? 0.5 : 1,
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
                      <div className="shrink-0">{option.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div
                          className="text-sm font-bold"
                          style={{ color: "#e0e0e0", fontFamily: "monospace" }}
                        >
                          {option.name}
                        </div>
                        <div className="text-xs mt-0.5" style={{ color: "#555" }}>
                          {option.description}
                        </div>
                      </div>
                      {isConnecting && (
                        <div
                          className="w-4 h-4 rounded-full border-2 border-t-transparent shrink-0"
                          style={{
                            borderColor: "rgba(0,255,136,0.5)",
                            borderTopColor: "transparent",
                            animation: "spin 0.8s linear infinite",
                          }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Footer */}
              <div
                className="px-5 py-3 text-xs text-center"
                style={{ borderTop: "1px solid #1a1a1a", color: "#333" }}
              >
                By connecting you agree to the{" "}
                <span style={{ color: "#555" }}>terms of service</span>
              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Connected account dropdown
// ---------------------------------------------------------------------------

interface AccountDropdownProps {
  address: `0x${string}`;
  onDisconnect: () => void;
  onClose: () => void;
  onSwitchWallet: () => void;
}

function AccountDropdown({ address, onDisconnect, onClose, onSwitchWallet }: AccountDropdownProps) {
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  function copyAddress() {
    navigator.clipboard.writeText(address).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const items: Array<{
    label: string;
    icon: React.ReactNode;
    color: string;
    href?: string;
    onClick?: () => void;
  }> = [
    {
      label: "My Profile",
      icon: <User size={13} />,
      href: "/profile/me",
      color: "#00ff88",
    },
    {
      label: copied ? "Copied!" : "Copy Address",
      icon: <Copy size={13} />,
      onClick: copyAddress,
      color: copied ? "#00ff88" : "#aaa",
    },
    {
      label: "View on Basescan",
      icon: <ExternalLink size={13} />,
      onClick: () => window.open(`https://basescan.org/address/${address}`, "_blank"),
      color: "#aaa",
    },
    {
      label: "Buy $RUSH",
      icon: <Plus size={13} />,
      onClick: () => window.open("https://flaunch.gg/base/coins/0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b", "_blank"),
      color: "#ffd700",
    },
    {
      label: "Switch Wallet",
      icon: <RefreshCw size={13} />,
      onClick: () => { onSwitchWallet(); onClose(); },
      color: "#aaa",
    },
    {
      label: "Disconnect",
      icon: <LogOut size={13} />,
      onClick: () => { onDisconnect(); onClose(); },
      color: "#ff4444",
    },
  ];

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: -6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.97 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className="absolute right-0 top-full mt-2 w-48 rounded-lg overflow-hidden z-50"
      style={{
        background: "#111",
        border: "1px solid #2a2a2a",
        boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
      }}
      role="menu"
    >
      {items.map((item, i) => {
        const common = {
          className: "w-full flex items-center gap-3 px-4 py-2.5 text-xs transition-colors text-left",
          style: {
            color: item.color,
            fontFamily: "monospace",
            background: "transparent",
            border: "none",
            borderTop: i > 0 ? "1px solid #1a1a1a" : "none",
            cursor: "pointer",
          } as React.CSSProperties,
          onMouseEnter: (e: React.MouseEvent<HTMLElement>) => ((e.currentTarget as HTMLElement).style.background = "#1a1a1a"),
          onMouseLeave: (e: React.MouseEvent<HTMLElement>) => ((e.currentTarget as HTMLElement).style.background = "transparent"),
          role: "menuitem" as const,
        };
        if (item.href) {
          return (
            <Link key={item.label} href={item.href} onClick={onClose} {...common}>
              {item.icon}
              {item.label}
            </Link>
          );
        }
        return (
          <button key={item.label} onClick={item.onClick} {...common}>
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main WalletButton
// ---------------------------------------------------------------------------

export function WalletButton() {
  const { address, isConnected, chainId } = useAccount();
  const { disconnect } = useDisconnect();
  const { data: balanceData } = useBalance({ address });
  const { switchChain } = useSwitchChain();
  const isWrongChain = isConnected && !!chainId && chainId !== base.id;

  const [modalOpen, setModalOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const openModal = useCallback(() => setModalOpen(true), []);
  const closeModal = useCallback(() => setModalOpen(false), []);
  const closeDropdown = useCallback(() => setDropdownOpen(false), []);

  const handleSwitchWallet = useCallback(() => {
    disconnect();
    setTimeout(() => setModalOpen(true), 150);
  }, [disconnect]);

  // Auto-switch to Base when on wrong chain
  useEffect(() => {
    if (isWrongChain && switchChain) {
      switchChain({ chainId: base.id });
    }
  }, [isWrongChain, switchChain]);

  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : "";

  const ethBalance = balanceData
    ? parseFloat(formatEther(balanceData.value)).toFixed(4)
    : null;

  if (isWrongChain) {
    return (
      <>
        <button
          onClick={() => switchChain?.({ chainId: base.id })}
          className="flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold tracking-wider transition-all animate-pulse"
          style={{
            background: "rgba(255,68,68,0.15)",
            border: "1px solid rgba(255,68,68,0.4)",
            color: "#ff4444",
            fontFamily: "monospace",
          }}
          aria-label="Switch to Base network"
        >
          Switch to Base
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
          className="flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold tracking-wider transition-all"
          style={{
            background: "rgba(0,255,136,0.1)",
            border: "1px solid rgba(0,255,136,0.3)",
            color: "#00ff88",
            fontFamily: "monospace",
            letterSpacing: "0.08em",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "rgba(0,255,136,0.18)";
            (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,255,136,0.5)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "rgba(0,255,136,0.1)";
            (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,255,136,0.3)";
          }}
          aria-label="Connect Wallet"
        >
          Connect Wallet
        </button>
        <WalletModal isOpen={modalOpen} onClose={closeModal} />
      </>
    );
  }

  return (
    <>
      <div className="relative">
        <button
          onClick={() => setDropdownOpen((d) => !d)}
          className="flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold transition-all"
          style={{
            background: "#111",
            border: "1px solid #2a2a2a",
            color: "#e0e0e0",
            fontFamily: "monospace",
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.borderColor = "#3a3a3a")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.borderColor = "#2a2a2a")}
          aria-label="Wallet menu"
          aria-expanded={dropdownOpen}
          aria-haspopup="menu"
        >
          {/* Green connected dot */}
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: "#00ff88", boxShadow: "0 0 6px rgba(0,255,136,0.7)" }}
          />
          <span style={{ color: "#00ff88" }}>{shortAddress}</span>
          {ethBalance !== null && (
            <span style={{ color: "#555" }}>{ethBalance} ETH</span>
          )}
          <ChevronDown
            size={12}
            style={{
              color: "#555",
              transform: dropdownOpen ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.15s",
            }}
          />
        </button>

        <AnimatePresence>
          {dropdownOpen && (
            <AccountDropdown
              address={address!}
              onDisconnect={disconnect}
              onClose={closeDropdown}
              onSwitchWallet={handleSwitchWallet}
            />
          )}
        </AnimatePresence>
      </div>

      <WalletModal isOpen={modalOpen} onClose={closeModal} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Hook for other components that need "open wallet modal" functionality
// ---------------------------------------------------------------------------

export function useWalletModal() {
  const [isOpen, setIsOpen] = useState(false);
  return {
    isOpen,
    openModal: useCallback(() => setIsOpen(true), []),
    closeModal: useCallback(() => setIsOpen(false), []),
    WalletModalComponent: () => (
      <WalletModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    ),
  };
}
