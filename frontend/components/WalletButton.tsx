"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAccount, useConnect, useDisconnect, useBalance } from "wagmi";
import { formatEther } from "viem";
import { Copy, LogOut, ExternalLink, ChevronDown, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// ---------------------------------------------------------------------------
// Wallet icons — inline SVGs so no external deps needed
// ---------------------------------------------------------------------------

function MetaMaskIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M36.1 3L22.1 13.3l2.6-6.1L36.1 3z" fill="#E17726" stroke="#E17726" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M3.9 3l13.8 10.4-2.5-6.1L3.9 3z" fill="#E27625" stroke="#E27625" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M31 27.5l-3.7 5.7 7.9 2.2 2.3-7.7-6.5-.2zM2.5 27.7l2.2 7.7 7.9-2.2-3.7-5.7-6.4.2z" fill="#E27625" stroke="#E27625" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M12.2 17.8l-2.2 3.3 7.8.4-.3-8.4-5.3 4.7zm15.6 0l-5.4-4.8-.3 8.5 7.8-.4-2.1-3.3z" fill="#E27625" stroke="#E27625" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M12.6 33.2l4.7-2.3-4-3.1-.7 5.4zm10.1-2.3l4.7 2.3-.8-5.4-3.9 3.1z" fill="#E27625" stroke="#E27625" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M27.4 33.2l-4.7-2.3.4 3.2-.1 1.9 4.4-2.8zm-14.8 0l4.4 2.8-.1-1.9.4-3.2-4.7 2.3z" fill="#D5BFB2" stroke="#D5BFB2" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M17.1 24.5l-3.9-1.1 2.7-1.3 1.2 2.4zm5.8 0l1.2-2.4 2.7 1.3-3.9 1.1z" fill="#233447" stroke="#233447" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M12.6 33.2l.7-5.7-4.4.2 3.7 5.5zm14.1-5.7l.7 5.7 3.7-5.5-4.4-.2zm3.3-10.4l-7.8.4.7 4.1 1.2-2.4 2.7 1.3 3.2-3.4zm-18.4 3.4l2.7-1.3 1.2 2.4.7-4.1-7.8-.4 3.2 3.4z" fill="#CC6228" stroke="#CC6228" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M10 17.1l3.3 6.4-.1-3.2L10 17.1zm16.8 3.2l-.1 3.2 3.3-6.4-3.2 3.2zm-9 .8l-.7 4.1.9 4.6.2-6.1-.4-2.6zm4.4 0l-.4 2.6.2 6.1.9-4.6-.7-4.1z" fill="#E27625" stroke="#E27625" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M22.9 24.5l-.9 4.6.6.5 3.9-3.1.1-3.2-3.7 1.2zm-9.7-1.1l.1 3.2 3.9 3.1.6-.5-.9-4.6-3.7-1.2z" fill="#F5841F" stroke="#F5841F" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M23 36l.1-1.9-.3-.3h-5.5l-.3.3.1 1.9-4.4-2.8 1.5 1.3 3.1 2.1h5.3l3.1-2.1 1.5-1.3L23 36z" fill="#C0AC9D" stroke="#C0AC9D" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M22.7 30.9l-.6-.5h-4.2l-.6.5-.4 3.2.3-.3h5.5l.3.3-.3-3.2z" fill="#161616" stroke="#161616" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M36.8 13.8L38 7.5l-1.9-4.5L22.7 13.6l5 4.2 7.1 2.1 1.6-1.8-.7-.5 1.1-1-.8-.6 1.1-.9-.3-.8zm-33.6 0l-1.2-6.3L3.9 3 17.3 13.6l5 4.2-7.1 2.1-1.6-1.8.7-.5-1.1-1 .8-.6-1.1-.9.3-.8z" fill="#763E1A" stroke="#763E1A" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M34.8 20l-7.1-2.1 2.1 3.2-3.3 6.4 4.4-.1h6.5L34.8 20zm-22.6-2.1L5 20l-2.6 7.4h6.5l4.4.1-3.3-6.4 2.2-3.2z" fill="#F5841F" stroke="#F5841F" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M17.1 21.1l-.7 4.1 2.9 5.7.4-8.4-2.6-1.4zm5.8 0l-2.5 1.4.4 8.4 2.9-5.7-.8-4.1z" fill="#C0AC9D" stroke="#C0AC9D" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M22.3 25.2l-2.9 5.7.6.5h4.2l.6-.5-2.9-5.7h.4z" fill="#161616" stroke="#161616" strokeWidth=".25" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function PhantomIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="40" height="40" rx="8" fill="#AB9FF2"/>
      <path d="M33.5 20c0 7.456-6.044 13.5-13.5 13.5S6.5 27.456 6.5 20 12.544 6.5 20 6.5 33.5 12.544 33.5 20z" fill="#fff"/>
      <path d="M28 20.5c0 4.142-3.358 7.5-7.5 7.5S13 24.642 13 20.5s3.358-7.5 7.5-7.5 7.5 3.358 7.5 7.5z" fill="#AB9FF2"/>
      <circle cx="17.5" cy="19.5" r="2.5" fill="#fff"/>
      <circle cx="22.5" cy="19.5" r="2.5" fill="#fff"/>
      <circle cx="17.5" cy="19.5" r="1.5" fill="#1C1C28"/>
      <circle cx="22.5" cy="19.5" r="1.5" fill="#1C1C28"/>
    </svg>
  );
}

function CoinbaseIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="40" height="40" rx="8" fill="#0052FF"/>
      <path d="M20 8C13.373 8 8 13.373 8 20s5.373 12 12 12 12-5.373 12-12S26.627 8 20 8z" fill="#fff"/>
      <path d="M17 16h6c.553 0 1 .447 1 1v6c0 .553-.447 1-1 1h-6c-.553 0-1-.447-1-1v-6c0-.553.447-1 1-1z" fill="#0052FF"/>
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

    // Find the right wagmi connector
    let connector = connectors.find((c) => {
      if (optionId === "coinbaseWallet") return c.id === "coinbaseWallet";
      // MetaMask and Phantom both use the injected connector
      return c.id === "injected" || c.type === "injected";
    });

    if (!connector) {
      // Fallback: use the first available connector
      connector = connectors[0];
    }

    if (connector) {
      try {
        connect({ connector });
        onClose();
      } catch {
        // Connection cancelled or failed — user sees the modal stays open
      }
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
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.75)" }}
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
}

function AccountDropdown({ address, onDisconnect, onClose }: AccountDropdownProps) {
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
