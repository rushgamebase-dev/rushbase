"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { MessageSquare, X, Send, ChevronRight, ChevronLeft } from "lucide-react";
import { useAccount } from "wagmi";
import { useChat } from "@/lib/chat";
import type { ChatMessage } from "@/lib/chat";

const EMOJIS = ["🔥", "🚗", "💰", "📈", "📉", "👀", "🎯", "💎", "🤑"];
const RATE_LIMIT_MS = 2000;

interface ChatProps {
  onCollapse?: (collapsed: boolean) => void;
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

export default function Chat({ onCollapse }: ChatProps) {
  const { address } = useAccount();
  const { messages, status, sendMessage } = useChat(address);
  const [input, setInput] = useState("");
  const [lastSent, setLastSent] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  // Shrinks the drawer when the iOS/Android keyboard opens so the input
  // never hides behind it. Falls back to 65dvh when visualViewport isn't
  // available (older browsers / desktop).
  const [drawerHeight, setDrawerHeight] = useState<string>("65dvh");

  // Separate refs for desktop and mobile scroll targets
  const desktopScrollRef = useRef<HTMLDivElement>(null);
  const mobileScrollRef = useRef<HTMLDivElement>(null);
  const desktopInputRef = useRef<HTMLInputElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll WITHIN the chat container only (not the page)
  useEffect(() => {
    if (!collapsed && desktopScrollRef.current) {
      const el = desktopScrollRef.current;
      el.scrollTop = el.scrollHeight;
    }
    if (mobileOpen && mobileScrollRef.current) {
      const el = mobileScrollRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, collapsed, mobileOpen]);

  // Keyboard-aware drawer height (mobile). When the virtual keyboard opens
  // visualViewport.height shrinks; we bind the drawer to min(65%, avail-48px).
  useEffect(() => {
    if (!mobileOpen || typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const update = () => {
      const avail = Math.max(240, vv.height - 48);
      const target = Math.min(avail, Math.floor(window.innerHeight * 0.65));
      setDrawerHeight(`${target}px`);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      setDrawerHeight("65dvh");
    };
  }, [mobileOpen]);

  const doSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    const now = Date.now();
    if (now - lastSent < RATE_LIMIT_MS) return;
    sendMessage(text);
    setInput("");
    setLastSent(now);
    setShowEmoji(false);
    // Re-focus input after sending
    setTimeout(() => {
      desktopInputRef.current?.focus();
      mobileInputRef.current?.focus();
    }, 50);
  }, [input, lastSent, sendMessage]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        doSend();
      }
    },
    [doSend],
  );

  function toggleCollapse() {
    const next = !collapsed;
    setCollapsed(next);
    onCollapse?.(next);
  }

  const rateLimited = Date.now() - lastSent < RATE_LIMIT_MS;
  const isOwn = (msg: ChatMessage) =>
    !!address && msg.address?.toLowerCase() === address.toLowerCase();

  // ── Render helpers (not components — avoids re-mount / focus loss) ─────────

  function renderMessage(msg: ChatMessage) {
    const own = isOwn(msg);
    return (
      <div
        key={msg.id}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: own ? "flex-end" : "flex-start",
          marginBottom: 4,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 1, padding: own ? "0 6px 0 0" : "0 0 0 6px" }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: msg.color, fontFamily: "monospace" }}>
            {msg.username}
          </span>
          <span style={{ fontSize: 9, color: "#333", fontFamily: "monospace" }}>
            {timeAgo(msg.timestamp)}
          </span>
        </div>
        <div
          style={{
            background: own ? "rgba(0,255,136,0.08)" : "#151515",
            border: own ? "1px solid rgba(0,255,136,0.15)" : "1px solid #1e1e1e",
            borderRadius: own ? "10px 10px 3px 10px" : "10px 10px 10px 3px",
            padding: "5px 9px",
            maxWidth: "85%",
            wordBreak: "break-word",
          }}
        >
          <span style={{ fontSize: 12, color: own ? "#c0ffd8" : "#bbb", lineHeight: 1.35 }}>
            {msg.text}
          </span>
        </div>
      </div>
    );
  }

  function renderEmptyState() {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 6, opacity: 0.4 }}>
        <MessageSquare size={20} />
        <span style={{ fontSize: 10, fontFamily: "monospace" }}>No messages yet</span>
      </div>
    );
  }

  function renderEmojiPicker() {
    if (!showEmoji) return null;
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3, padding: "6px 10px", borderBottom: "1px solid #1a1a1a" }}>
        {EMOJIS.map((e) => (
          <button
            key={e}
            onClick={() => { setInput((p) => p + e); }}
            style={{ padding: "2px 7px", borderRadius: 5, fontSize: 13, background: "#1a1a1a", border: "1px solid #252525", cursor: "pointer" }}
          >
            {e}
          </button>
        ))}
      </div>
    );
  }

  function renderInput(ref: React.RefObject<HTMLInputElement>, mobile = false) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: mobile ? "8px 10px" : "6px 8px", flexShrink: 0 }}>
        <button
          onClick={() => setShowEmoji((s) => !s)}
          style={{ fontSize: 15, opacity: showEmoji ? 1 : 0.3, background: "none", border: "none", cursor: "pointer", padding: 0 }}
          aria-label="Emoji"
        >
          🎯
        </button>
        <input
          ref={ref}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, 150))}
          onKeyDown={onKeyDown}
          placeholder={rateLimited ? "Hold on..." : "Type a message..."}
          maxLength={150}
          disabled={rateLimited}
          autoComplete="off"
          inputMode="text"
          enterKeyHint="send"
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            // iOS auto-zooms inputs < 16px on focus — stay ≥ 16px on mobile.
            fontSize: mobile ? 16 : 12,
            color: "#e0e0e0",
            caretColor: "#00ff88",
            fontFamily: "monospace",
            opacity: rateLimited ? 0.3 : 1,
          }}
        />
        <button
          onClick={doSend}
          disabled={!input.trim() || rateLimited}
          style={{
            width: mobile ? 34 : 26,
            height: mobile ? 34 : 26,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 7,
            border: "none",
            cursor: input.trim() && !rateLimited ? "pointer" : "default",
            background: input.trim() && !rateLimited ? "#00ff88" : "#1a1a1a",
            color: input.trim() && !rateLimited ? "#000" : "#444",
            transition: "all 0.15s",
            flexShrink: 0,
          }}
          aria-label="Send"
        >
          <Send size={mobile ? 13 : 11} />
        </button>
      </div>
    );
  }

  function renderHeader(opts: { showCollapse?: boolean; onClose?: () => void }) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderBottom: "1px solid #1a1a1a", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            width: 6, height: 6, borderRadius: "50%", display: "inline-block",
            background: status === "connected" ? "#00ff88" : status === "connecting" ? "#ffaa00" : "#ff4444",
            boxShadow: status === "connected" ? "0 0 6px #00ff88" : "none",
          }} />
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", color: "#e0e0e0", fontFamily: "monospace" }}>
            CHAT
          </span>
          <span style={{
            fontSize: 9,
            color: status === "connected" ? "#00ff88" : status === "connecting" ? "#ffaa00" : "#ff4444",
            fontFamily: "monospace",
          }}>
            {status === "connected" ? "live" : status === "connecting" ? "connecting..." : "offline"}
          </span>
        </div>
        {opts.showCollapse && (
          <button
            onClick={toggleCollapse}
            className="hidden md:flex items-center justify-center"
            style={{ width: 22, height: 22, color: "#444", background: "transparent", border: "none", cursor: "pointer" }}
            aria-label={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}
          </button>
        )}
        {opts.onClose && (
          <button onClick={opts.onClose} style={{ color: "#555", background: "none", border: "none", cursor: "pointer" }} aria-label="Close">
            <X size={16} />
          </button>
        )}
      </div>
    );
  }

  // ── Desktop ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Desktop sidebar */}
      <div
        className="hidden md:flex flex-col"
        style={{ height: "100vh", maxHeight: "100vh", overflow: "hidden", background: "#0c0c0c" }}
      >
        {renderHeader({ showCollapse: true })}

        {!collapsed && (
          <>
            <div
              ref={desktopScrollRef}
              style={{ flex: "1 1 0", minHeight: 0, overflowY: "auto", padding: "6px 6px 2px 6px" }}
            >
              {messages.length === 0 ? renderEmptyState() : messages.map(renderMessage)}
            </div>

            <div style={{ borderTop: "1px solid #1a1a1a", flexShrink: 0 }}>
              {renderEmojiPicker()}
              {renderInput(desktopInputRef)}
            </div>
          </>
        )}
      </div>

      {/* Mobile floating button + drawer */}
      <div className="md:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          className="fixed bottom-6 right-4 z-40"
          style={{
            width: 46, height: 46, borderRadius: "50%",
            background: "#00ff88", color: "#000", border: "none",
            boxShadow: "0 0 18px rgba(0,255,136,0.35)", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          aria-label="Open chat"
        >
          <MessageSquare size={18} />
        </button>

        {mobileOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              style={{ background: "rgba(0,0,0,0.6)" }}
              onClick={() => setMobileOpen(false)}
            />
            <div
              className="fixed bottom-0 left-0 right-0 z-50 flex flex-col"
              style={{ height: drawerHeight, maxHeight: "85dvh", paddingBottom: "env(safe-area-inset-bottom)", background: "#0c0c0c", borderTop: "1px solid #2a2a2a", borderRadius: "12px 12px 0 0" }}
            >
              <div style={{ display: "flex", justifyContent: "center", padding: "6px 0 0" }}>
                <div style={{ width: 32, height: 3, borderRadius: 2, background: "#333" }} />
              </div>

              {renderHeader({ onClose: () => setMobileOpen(false) })}

              <div
                ref={mobileScrollRef}
                style={{ flex: "1 1 0", minHeight: 0, overflowY: "auto", padding: "6px 10px 2px 10px" }}
              >
                {messages.length === 0 ? renderEmptyState() : messages.map(renderMessage)}
              </div>

              <div style={{ borderTop: "1px solid #1a1a1a", flexShrink: 0 }}>
                {renderEmojiPicker()}
                {renderInput(mobileInputRef, true)}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
