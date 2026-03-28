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

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
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
  const RATE_LIMIT_MS = 3000;

  // Auto-scroll on new messages
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

  const ChatContent = (
    <div
      className="flex flex-col h-full"
      style={{
        background: "#0e0e0e",
        border: collapsed ? "none" : "1px solid #1a1a1a",
        borderRadius: 0,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2.5 shrink-0"
        style={{ borderBottom: "1px solid #1a1a1a" }}
      >
        <div className="flex items-center gap-2">
          <span className="live-dot-green" />
          <span
            className="text-xs font-bold tracking-widest"
            style={{ color: "#e0e0e0", fontFamily: "monospace" }}
          >
            LIVE CHAT
          </span>
          <span
            className="text-xs"
            style={{ color: "#444", fontFamily: "monospace" }}
          >
            {onlineCount} online
          </span>
        </div>
        <button
          onClick={toggleCollapse}
          className="hidden md:flex items-center justify-center w-6 h-6 rounded transition-colors"
          style={{ color: "#444", background: "transparent" }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "#aaa")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "#444")}
          aria-label={collapsed ? "Expand chat" : "Collapse chat"}
        >
          {collapsed ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </button>
      </div>

      {/* Messages */}
      {!collapsed && (
        <>
          <div
            className="flex-1 overflow-y-auto px-3 py-2"
            style={{ minHeight: 0 }}
            role="log"
            aria-live="polite"
            aria-label="Chat messages"
          >
            {messages.map((msg: ChatMessage) => (
              <div
                key={msg.id}
                className="mb-1.5 animate-fade-in-up leading-snug"
              >
                <span
                  className="text-xs font-bold mr-1.5"
                  style={{ color: msg.color, fontFamily: "monospace" }}
                >
                  {msg.username}
                </span>
                <span
                  className="text-xs"
                  style={{ color: "#999" }}
                >
                  {msg.text}
                </span>
                <span
                  className="ml-1.5 text-xs"
                  style={{ color: "#333", fontFamily: "monospace" }}
                >
                  {formatTime(msg.timestamp)}
                </span>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Emoji picker */}
          {showEmoji && (
            <div
              className="flex flex-wrap gap-1 px-3 py-2 animate-fade-in-up"
              style={{ borderTop: "1px solid #1a1a1a" }}
            >
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  onClick={() => appendEmoji(e)}
                  className="px-1.5 py-0.5 rounded text-xs transition-colors"
                  style={{
                    background: "#1a1a1a",
                    color: "#e0e0e0",
                    border: "1px solid #222",
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div
            className="flex items-center gap-1.5 px-3 py-2 shrink-0"
            style={{ borderTop: "1px solid #1a1a1a" }}
          >
            <button
              onClick={() => setShowEmoji((s) => !s)}
              className="text-base transition-opacity"
              style={{ opacity: showEmoji ? 1 : 0.4, background: "none", border: "none" }}
              aria-label="Toggle emoji picker"
              tabIndex={0}
            >
              🎯
            </button>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value.slice(0, 100))}
              onKeyDown={handleKeyDown}
              placeholder={rateLimited ? "Wait 3s..." : "Say something..."}
              maxLength={100}
              disabled={rateLimited}
              className="flex-1 bg-transparent text-xs focus:outline-none"
              style={{
                color: "#e0e0e0",
                caretColor: "#00ff88",
                fontFamily: "monospace",
                opacity: rateLimited ? 0.4 : 1,
              }}
              aria-label="Chat input"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || rateLimited}
              className="w-6 h-6 flex items-center justify-center rounded transition-all"
              style={{
                background: input.trim() && !rateLimited ? "#00ff88" : "#1a1a1a",
                color: input.trim() && !rateLimited ? "#000" : "#444",
              }}
              aria-label="Send message"
            >
              <Send size={11} />
            </button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop: sidebar panel */}
      <div className="hidden md:flex flex-col h-full w-full">{ChatContent}</div>

      {/* Mobile: floating button + drawer */}
      <div className="md:hidden">
        {/* Floating button */}
        <button
          onClick={() => setMobileOpen(true)}
          className="fixed bottom-6 right-4 z-40 w-12 h-12 rounded-full flex items-center justify-center shadow-lg"
          style={{
            background: "#00ff88",
            color: "#000",
            boxShadow: "0 0 20px rgba(0,255,136,0.4)",
          }}
          aria-label="Open chat"
        >
          <MessageSquare size={20} />
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
                background: "#0e0e0e",
                borderTop: "1px solid #2a2a2a",
                borderRadius: "12px 12px 0 0",
              }}
              role="dialog"
              aria-label="Live chat"
              aria-modal="true"
            >
              <div
                className="flex items-center justify-between px-4 py-3 shrink-0"
                style={{ borderBottom: "1px solid #1a1a1a" }}
              >
                <div className="flex items-center gap-2">
                  <span className="live-dot-green" />
                  <span
                    className="text-xs font-bold tracking-widest"
                    style={{ color: "#e0e0e0", fontFamily: "monospace" }}
                  >
                    LIVE CHAT — {onlineCount} online
                  </span>
                </div>
                <button
                  onClick={() => setMobileOpen(false)}
                  style={{ color: "#666", background: "none", border: "none" }}
                  aria-label="Close chat"
                >
                  <X size={18} />
                </button>
              </div>

              <div
                className="flex-1 overflow-y-auto px-4 py-2"
                role="log"
                aria-live="polite"
              >
                {messages.map((msg: ChatMessage) => (
                  <div key={msg.id} className="mb-1.5 leading-snug">
                    <span
                      className="text-xs font-bold mr-1.5"
                      style={{ color: msg.color, fontFamily: "monospace" }}
                    >
                      {msg.username}
                    </span>
                    <span className="text-xs" style={{ color: "#999" }}>
                      {msg.text}
                    </span>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              <div
                className="flex items-center gap-2 px-4 py-3 shrink-0"
                style={{ borderTop: "1px solid #1a1a1a" }}
              >
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value.slice(0, 100))}
                  onKeyDown={handleKeyDown}
                  placeholder="Say something..."
                  className="flex-1 bg-transparent text-sm focus:outline-none"
                  style={{ color: "#e0e0e0", caretColor: "#00ff88" }}
                />
                <button
                  onClick={handleSend}
                  disabled={!input.trim()}
                  className="px-3 py-1.5 rounded text-xs font-bold transition-all"
                  style={{
                    background: input.trim() ? "#00ff88" : "#1a1a1a",
                    color: input.trim() ? "#000" : "#444",
                  }}
                >
                  Send
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
