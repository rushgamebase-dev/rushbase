"use client";

import { useState, useEffect } from "react";

const STORAGE_KEY = "rush_visited";

const STEPS = [
  {
    num: "01",
    title: "WATCH",
    desc: "Live traffic cameras stream 24/7 from real locations worldwide",
  },
  {
    num: "02",
    title: "PREDICT",
    desc: "Guess if the vehicle count goes OVER or UNDER the threshold in 5 minutes",
  },
  {
    num: "03",
    title: "WIN",
    desc: "Correct predictions split the pool. All bets verified on-chain.",
  },
];

export default function WelcomeOverlay() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setVisible(true);
      }
    } catch {
      // localStorage unavailable (SSR guard already handled by useEffect, but
      // some privacy modes throw on access)
    }
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // ignore
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Rush — how it works"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.82)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        animation: "rushOverlayFadeIn 0.35s ease-out forwards",
        padding: "16px",
      }}
      onClick={(e) => {
        // Dismiss on backdrop click
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div
        style={{
          background: "#0f0f0f",
          border: "1px solid rgba(0,255,136,0.25)",
          borderRadius: 12,
          boxShadow: "0 0 60px rgba(0,255,136,0.12), 0 24px 64px rgba(0,0,0,0.6)",
          maxWidth: "min(480px, calc(100vw - 32px))",
          width: "100%",
          padding: "20px 16px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        {/* Title */}
        <div style={{ textAlign: "center" }}>
          <h2
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
              fontSize: 26,
              fontWeight: 900,
              color: "#00ff88",
              letterSpacing: "0.1em",
              textShadow: "0 0 28px rgba(0,255,136,0.45)",
              margin: 0,
            }}
          >
            WELCOME TO RUSH
          </h2>
          <p
            style={{
              fontFamily: "monospace",
              fontSize: 12,
              color: "#555",
              marginTop: 6,
              letterSpacing: "0.04em",
            }}
          >
            The on-chain prediction market powered by a live camera
          </p>
        </div>

        {/* 3-step explanation */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {STEPS.map((step) => (
            <div
              key={step.num}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 14,
                background: "rgba(255,255,255,0.025)",
                border: "1px solid #1a1a1a",
                borderRadius: 8,
                padding: "12px 14px",
              }}
            >
              <span
                style={{
                  fontFamily: "monospace",
                  fontSize: 11,
                  fontWeight: 900,
                  color: "rgba(0,255,136,0.5)",
                  letterSpacing: "0.06em",
                  marginTop: 1,
                  flexShrink: 0,
                }}
              >
                {step.num}
              </span>
              <div>
                <div
                  style={{
                    fontFamily: "monospace",
                    fontSize: 13,
                    fontWeight: 900,
                    color: "#00ff88",
                    letterSpacing: "0.12em",
                    marginBottom: 3,
                  }}
                >
                  {step.title}
                </div>
                <div
                  style={{
                    fontFamily: "monospace",
                    fontSize: 12,
                    color: "#888",
                    lineHeight: 1.5,
                  }}
                >
                  {step.desc}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* CTA button */}
        <button
          onClick={dismiss}
          autoFocus
          style={{
            width: "100%",
            padding: "14px 20px",
            borderRadius: 8,
            border: "none",
            background: "rgba(0,255,136,0.9)",
            color: "#000",
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            fontSize: 13,
            fontWeight: 900,
            letterSpacing: "0.1em",
            cursor: "pointer",
            boxShadow: "0 0 28px rgba(0,255,136,0.35)",
            transition: "background 0.15s, box-shadow 0.15s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "#00ff88";
            (e.currentTarget as HTMLButtonElement).style.boxShadow =
              "0 0 40px rgba(0,255,136,0.55)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "rgba(0,255,136,0.9)";
            (e.currentTarget as HTMLButtonElement).style.boxShadow =
              "0 0 28px rgba(0,255,136,0.35)";
          }}
          aria-label="Dismiss welcome screen and start playing"
        >
          GOT IT — LET ME PLAY
        </button>

        {/* Footer note */}
        <p
          style={{
            fontFamily: "monospace",
            fontSize: 10,
            color: "#333",
            textAlign: "center",
            margin: 0,
            letterSpacing: "0.05em",
          }}
        >
          Powered by AI (YOLOv8) + Base Chain
        </p>
      </div>
    </div>
  );
}
