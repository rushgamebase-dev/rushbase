"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAccount, useConnect, useDisconnect, useBalance } from "wagmi";
import { formatEther } from "viem";
import { Copy, LogOut, ExternalLink, ChevronDown, X, RefreshCw, Plus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// ---------------------------------------------------------------------------
// Wallet icons — inline SVGs so no external deps needed
// ---------------------------------------------------------------------------

function MetaMaskIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 318.6 318.6" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path fill="#E2761B" stroke="#E2761B" strokeLinecap="round" strokeLinejoin="round" d="m274.1 35.5-99.5 73.9L193 65.8z"/>
      <path fill="#E4761B" stroke="#E4761B" strokeLinecap="round" strokeLinejoin="round" d="m44.4 35.5 98.7 74.6-17.5-44.3zm193.9 171.3-26.5 40.6 56.7 15.6 16.3-55.3zm-204.4.9L50.1 263l56.7-15.6-26.5-40.6z"/>
      <path fill="#E4761B" stroke="#E4761B" strokeLinecap="round" strokeLinejoin="round" d="m103.6 138.2-15.8 23.9 56.3 2.5-2-60.5zm111.3 0-39-34.8-1.3 61.2 56.2-2.5zM106.8 247.4l33.8-16.5-29.2-22.8zm71.1-16.5 33.9 16.5-4.7-39.3z"/>
      <path fill="#D7C1B3" stroke="#D7C1B3" strokeLinecap="round" strokeLinejoin="round" d="m211.8 247.4-33.9-16.5 2.7 22.1-.3 9.3zm-105 0 31.5 14.9-.2-9.3 2.5-22.1z"/>
      <path fill="#233447" stroke="#233447" strokeLinecap="round" strokeLinejoin="round" d="m138.8 193.5-28.2-8.3 19.9-9.1zm40.9 0 8.3-17.4 20 9.1z"/>
      <path fill="#CD6116" stroke="#CD6116" strokeLinecap="round" strokeLinejoin="round" d="m106.8 247.4 4.8-40.6-31.3.9zM207 206.8l4.8 40.6 26.5-39.7zm23.8-44.7-56.2 2.5 5.2 28.9 8.3-17.4 20 9.1zm-120.2 23.1 20-9.1 8.2 17.4 5.3-28.9-56.3-2.5z"/>
      <path fill="#E4751F" stroke="#E4751F" strokeLinecap="round" strokeLinejoin="round" d="m87.8 162.1 23.6 46-.8-22.9zm120.3 23.1-1 22.9 23.7-46zm-64-20.6-5.3 28.9 6.6 34.1 1.5-44.9zm30.5 0-2.7 18 1.2 45 6.7-34.1z"/>
      <path fill="#F6851B" stroke="#F6851B" strokeLinecap="round" strokeLinejoin="round" d="m179.8 193.5-6.7 34.1 4.8 3.3 29.2-22.8 1-22.9zm-69.2-8.3.8 22.9 29.2 22.8 4.8-3.3-6.6-34.1z"/>
      <path fill="#C0AD9E" stroke="#C0AD9E" strokeLinecap="round" strokeLinejoin="round" d="m180.3 262.3.3-9.3-2.5-2.2h-37.7l-2.3 2.2.2 9.3-31.5-14.9 11 9 22.3 15.5h38.3l22.4-15.5 11-9z"/>
      <path fill="#161616" stroke="#161616" strokeLinecap="round" strokeLinejoin="round" d="m177.9 230.9-4.8-3.3h-27.7l-4.8 3.3-2.5 22.1 2.3-2.2h37.7l2.5 2.2z"/>
      <path fill="#763D16" stroke="#763D16" strokeLinecap="round" strokeLinejoin="round" d="m278.3 114.2 8.5-40.8-12.7-37.9-96.2 71.4 37 31.3 52.3 15.3 11.6-13.5-5-3.6 8-7.3-6.2-4.8 8-6.1zM31.8 73.4l8.5 40.8-5.4 4 8 6.1-6.1 4.8 8 7.3-5 3.6 11.5 13.5 52.3-15.3 37-31.3-96.2-71.4z"/>
      <path fill="#F6851B" stroke="#F6851B" strokeLinecap="round" strokeLinejoin="round" d="m267.2 153.5-52.3-15.3 15.9 23.9-23.7 46 31.2-.4h46.5zm-163.6-15.3-52.3 15.3-17.4 54.2h46.4l31.1.4-23.6-46z"/>
      <path fill="#F6851B" stroke="#F6851B" strokeLinecap="round" strokeLinejoin="round" d="m174.6 164.6-3.3-57.7-15.2 41.1h-30.8l-15-41.1-3.5 57.7-6.6 34.1 6.7-34.1 5.3-28.9 56.3 2.5 5.2 28.9z" opacity=".6"/>
    </svg>
  );
}

function PhantomIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="128" height="128" rx="26" fill="url(#phantom-grad)"/>
      <path d="M110.584 64.914H99.142C99.142 41.064 79.685 21.607 55.835 21.607C32.318 21.607 13.07 40.509 12.578 63.893C12.074 87.845 31.478 108.393 55.429 108.393H58.572C79.883 108.393 110.584 88.095 110.584 64.914Z" fill="url(#phantom-grad2)"/>
      <circle cx="44.336" cy="57.393" r="7.179" fill="#fff"/>
      <circle cx="73.107" cy="57.393" r="7.179" fill="#fff"/>
      <defs>
        <linearGradient id="phantom-grad" x1="64" y1="0" x2="64" y2="128" gradientUnits="userSpaceOnUse">
          <stop stopColor="#534BB1"/>
          <stop offset="1" stopColor="#551BF9"/>
        </linearGradient>
        <linearGradient id="phantom-grad2" x1="61.581" y1="21.607" x2="61.581" y2="108.393" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff"/>
          <stop offset="1" stopColor="#fff" stopOpacity=".82"/>
        </linearGradient>
      </defs>
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

  const walletOptions: WalletOption[] = [
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

    // Detect available wallets
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w: any = typeof window !== "undefined" ? window : {};
    const hasPhantom = !!w.phantom?.ethereum;
    const hasMetaMask = !!w.ethereum?.isMetaMask;

    let connector = connectors[0]; // fallback

    if (optionId === "coinbaseWallet") {
      connector = connectors.find((c) => c.id === "coinbaseWallet") || connector;
    } else if (optionId === "injected-phantom") {
      if (hasPhantom) {
        // Phantom has its own ethereum provider
        connector = connectors.find((c) => c.id === "injected") || connector;
        // Switch to Phantom's provider
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
      connector = connectors.find((c) => c.id === "injected") || connector;
    } else {
      // MetaMask
      if (!hasMetaMask) {
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
            {/* Modal panel */}
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
                      className="flex items-center gap-4 px-4 py-3.5 rounded-lg text-left transition-all group"
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

  const items = [
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
      label: "$RUSH Token — Coming Soon",
      icon: <Plus size={13} />,
      onClick: () => {},
      color: "#555",
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
      {items.map((item, i) => (
        <button
          key={item.label}
          onClick={item.onClick}
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
          role="menuitem"
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main WalletButton
// ---------------------------------------------------------------------------

export function WalletButton() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { data: balanceData } = useBalance({ address });

  const [modalOpen, setModalOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const openModal = useCallback(() => setModalOpen(true), []);
  const closeModal = useCallback(() => setModalOpen(false), []);
  const closeDropdown = useCallback(() => setDropdownOpen(false), []);

  const handleSwitchWallet = useCallback(() => {
    disconnect();
    setTimeout(() => setModalOpen(true), 150);
  }, [disconnect]);

  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : "";

  const ethBalance = balanceData
    ? parseFloat(formatEther(balanceData.value)).toFixed(4)
    : null;

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
