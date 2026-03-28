"use client";

import { useState, useEffect, useRef } from "react";
import { MessageSquare, X, Send, ChevronRight, ChevronLeft } from "lucide-react";
import { useAccount } from "wagmi";
import { useChat } from "@/lib/chat";
import type { ChatMessage } from "@/lib/chat";

const EMOJIS = ["🔥", "🚗", "💰", "📈", "📉", "👀", "🎯", "💎", "🤑", "gg"];

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
  const { messages, onlineCount, sendMessage } = useChat(address);
  const [input, setInput] = useState("");
  const [lastSent, setLastSent] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const RATE_LIMIT_MS = 2000;

  useEffect(() => {
    if (!collapsed) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, collapsed]);

  function handleSend() {
    const text = input.trim();
    if (!text) return;
    const now = Date.now();
    if (now - lastSent < RATE_LIMIT_MS) return;
    sendMessage(text);
    setInput("");
    setLastSent(now);
    setShowEmoji(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function appendEmoji(emoji: string) {
    setInput((prev) => prev + emoji);
    inputRef.current?.focus();
  }

  function toggleCollapse() {
    const next = !collapsed;
    setCollapsed(next);
    onCollapse?.(next);
  }

  const rateLimited = Date.now() - lastSent < RATE_LIMIT_MS;
  const isOwnMsg = (msg: ChatMessage) =>
    address && msg.address?.toLowerCase() === address.toLowerCase();

  // ── Message bubble ──────────────────────────────────────────────────────────

  function MessageBubble({ msg }: { msg: ChatMessage }) {
    const own = isOwnMsg(msg);

    return (
      <div
        className="animate-fade-in-up"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: own ? "flex-end" : "flex-start",
          marginBottom: 6,
        }}
      >
        {/* Username + time */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 2,
            padding: own ? "0 8px 0 0" : "0 0 0 8px",
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: msg.color,
              fontFamily: "monospace",
              letterSpacing: "0.02em",
            }}
          >
            {msg.username}
          </span>
          <span
            style={{
              fontSize: 9,
              color: "#333",
              fontFamily: "monospace",
            }}
          >
            {timeAgo(msg.timestamp)}
          </span>
        </div>

        {/* Bubble */}
        <div
          style={{
            background: own ? "rgba(0,255,136,0.08)" : "#151515",
            border: own
              ? "1px solid rgba(0,255,136,0.15)"
              : "1px solid #1e1e1e",
            borderRadius: own ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
            padding: "6px 10px",
            maxWidth: "85%",
            wordBreak: "break-word",
          }}
        >
          <span
            style={{
              fontSize: 12,
              color: own ? "#c0ffd8" : "#bbb",
              lineHeight: 1.4,
            }}
          >
            {msg.text}
          </span>
        </div>
      </div>
    );
  }

  // ── Empty state ─────────────────────────────────────────────────────────────

  function EmptyChat() {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          gap: 8,
          padding: 20,
        }}
      >
        <MessageSquare size={24} style={{ color: "#222" }} />
        <span style={{ fontSize: 11, color: "#333", fontFamily: "monospace", textAlign: "center" }}>
          No messages yet. Say something!
        </span>
      </div>
    );
  }

  // ── Input bar ───────────────────────────────────────────────────────────────

  function InputBar({ mobile = false }: { mobile?: boolean }) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 0,
          borderTop: "1px solid #1a1a1a",
        }}
      >
        {/* Emoji picker */}
        {showEmoji && (
          <div
            className="animate-fade-in-up"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 4,
              padding: "8px 12px",
              borderBottom: "1px solid #1a1a1a",
            }}
          >
            {EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => appendEmoji(e)}
                style={{
                  padding: "3px 8px",
                  borderRadius: 6,
                  fontSize: 13,
                  background: "#1a1a1a",
                  border: "1px solid #252525",
                  cursor: "pointer",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(el) => ((el.currentTarget as HTMLElement).style.background = "#252525")}
                onMouseLeave={(el) => ((el.currentTarget as HTMLElement).style.background = "#1a1a1a")}
              >
                {e}
              </button>
            ))}
          </div>
        )}

        {/* Input row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: mobile ? "10px 12px" : "8px 10px",
          }}
        >
          <button
            onClick={() => setShowEmoji((s) => !s)}
            style={{
              fontSize: 16,
              opacity: showEmoji ? 1 : 0.35,
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              transition: "opacity 0.15s",
            }}
            aria-label="Toggle emoji picker"
          >
            🎯
          </button>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, 150))}
            onKeyDown={handleKeyDown}
            placeholder={rateLimited ? "Hold on..." : "Type a message..."}
            maxLength={150}
            disabled={rateLimited}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              fontSize: mobile ? 14 : 12,
              color: "#e0e0e0",
              caretColor: "#00ff88",
              fontFamily: "monospace",
              opacity: rateLimited ? 0.35 : 1,
            }}
            aria-label="Chat input"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || rateLimited}
            style={{
              width: mobile ? 36 : 28,
              height: mobile ? 36 : 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 8,
              border: "none",
              cursor: input.trim() && !rateLimited ? "pointer" : "default",
              background: input.trim() && !rateLimited ? "#00ff88" : "#1a1a1a",
              color: input.trim() && !rateLimited ? "#000" : "#444",
              transition: "all 0.15s",
            }}
            aria-label="Send message"
          >
            <Send size={mobile ? 14 : 12} />
          </button>
        </div>
      </div>
    );
  }

  // ── Header bar ──────────────────────────────────────────────────────────────

  function ChatHeader({ showCollapse = false, onClose }: { showCollapse?: boolean; onClose?: () => void }) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 12px",
          borderBottom: "1px solid #1a1a1a",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="live-dot-green" />
          <span
            style={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.12em",
              color: "#e0e0e0",
              fontFamily: "monospace",
            }}
          >
            LIVE CHAT
          </span>
          {onlineCount > 0 && (
            <span
              style={{
                fontSize: 10,
                color: "#00ff88",
                fontFamily: "monospace",
                background: "rgba(0,255,136,0.08)",
                padding: "1px 6px",
                borderRadius: 4,
                fontWeight: 600,
              }}
            >
              {onlineCount} online
            </span>
          )}
          {onlineCount === 0 && (
            <span
              style={{
                fontSize: 10,
                color: "#444",
                fontFamily: "monospace",
              }}
            >
              0 online
            </span>
          )}
        </div>

        {showCollapse && (
          <button
            onClick={toggleCollapse}
            className="hidden md:flex items-center justify-center"
            style={{
              width: 24,
              height: 24,
              color: "#444",
              background: "transparent",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
              transition: "color 0.15s",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "#aaa")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "#444")}
            aria-label={collapsed ? "Expand chat" : "Collapse chat"}
          >
            {collapsed ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
          </button>
        )}

        {onClose && (
          <button
            onClick={onClose}
            style={{ color: "#666", background: "none", border: "none", cursor: "pointer" }}
            aria-label="Close chat"
          >
            <X size={18} />
          </button>
        )}
      </div>
    );
  }

  // ── Desktop sidebar ─────────────────────────────────────────────────────────

  const DesktopChat = (
    <div
      className="flex flex-col h-full"
      style={{
        background: "#0c0c0c",
        borderLeft: collapsed ? "none" : "1px solid #1a1a1a",
      }}
    >
      <ChatHeader showCollapse />

      {!collapsed && (
        <>
          <div
            className="flex-1 overflow-y-auto"
            style={{ minHeight: 0, padding: "8px 8px 4px 8px" }}
            role="log"
            aria-live="polite"
            aria-label="Chat messages"
          >
            {messages.length === 0 ? (
              <EmptyChat />
            ) : (
              messages.map((msg: ChatMessage) => (
                <MessageBubble key={msg.id} msg={msg} />
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          <InputBar />
        </>
      )}
    </div>
  );

  // ── Mobile drawer ───────────────────────────────────────────────────────────

  return (
    <>
      {/* Desktop */}
      <div className="hidden md:flex flex-col h-full w-full">{DesktopChat}</div>

      {/* Mobile: floating button */}
      <div className="md:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          className="fixed bottom-6 right-4 z-40 flex items-center justify-center shadow-lg"
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            background: "#00ff88",
            color: "#000",
            border: "none",
            boxShadow: "0 0 20px rgba(0,255,136,0.4)",
            cursor: "pointer",
          }}
          aria-label="Open chat"
        >
          <MessageSquare size={20} />
          {messages.length > 0 && (
            <span
              style={{
                position: "absolute",
                top: -2,
                right: -2,
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: "#ff4444",
                color: "#fff",
                fontSize: 9,
                fontWeight: 800,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "2px solid #0a0a0a",
              }}
            >
              {messages.length > 99 ? "99" : messages.length}
            </span>
          )}
        </button>

        {/* Mobile drawer */}
        {mobileOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              style={{ background: "rgba(0,0,0,0.6)" }}
              onClick={() => setMobileOpen(false)}
              aria-label="Close chat overlay"
            />
            <div
              className="fixed bottom-0 left-0 right-0 z-50 flex flex-col"
              style={{
                height: "70vh",
                background: "#0c0c0c",
                borderTop: "1px solid #2a2a2a",
                borderRadius: "14px 14px 0 0",
              }}
              role="dialog"
              aria-label="Live chat"
              aria-modal="true"
            >
              {/* Drag handle */}
              <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 0" }}>
                <div style={{ width: 36, height: 4, borderRadius: 2, background: "#333" }} />
              </div>

              <ChatHeader onClose={() => setMobileOpen(false)} />

              <div
                className="flex-1 overflow-y-auto"
                style={{ padding: "8px 12px 4px 12px", minHeight: 0 }}
                role="log"
                aria-live="polite"
              >
                {messages.length === 0 ? (
                  <EmptyChat />
                ) : (
                  messages.map((msg: ChatMessage) => (
                    <MessageBubble key={msg.id} msg={msg} />
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              <InputBar mobile />
            </div>
          </>
        )}
      </div>
    </>
  );
}
