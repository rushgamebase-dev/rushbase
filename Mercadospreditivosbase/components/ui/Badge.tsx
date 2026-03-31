"use client";

import type { MarketStatus } from "@/types/market";

// Usage:
// <Badge variant="hot">HOT</Badge>
// <Badge variant="category">CRYPTO</Badge>
// <Badge variant="status" data-status="open">OPEN</Badge>
// <Badge variant="status" data-status="locked">LOCKED</Badge>
// <Badge variant="live">LIVE</Badge>
// <Badge variant="chain">Base</Badge>

interface BadgeProps {
  variant?: "hot" | "category" | "status" | "live" | "chain";
  children: React.ReactNode;
  className?: string;
  "data-status"?: MarketStatus;
}

const statusStyles: Record<MarketStatus, React.CSSProperties> = {
  open: {
    background: "rgba(0, 255, 136, 0.1)",
    border: "1px solid rgba(0, 255, 136, 0.25)",
    color: "#00ff88",
  },
  locked: {
    background: "rgba(255, 215, 0, 0.1)",
    border: "1px solid rgba(255, 215, 0, 0.25)",
    color: "#ffd700",
  },
  resolved: {
    background: "rgba(68, 136, 255, 0.1)",
    border: "1px solid rgba(68, 136, 255, 0.25)",
    color: "#4488ff",
  },
  cancelled: {
    background: "rgba(255, 68, 68, 0.1)",
    border: "1px solid rgba(255, 68, 68, 0.25)",
    color: "#ff4444",
  },
};

export function Badge({
  variant = "category",
  children,
  className = "",
  "data-status": dataStatus,
}: BadgeProps) {
  const baseStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontFamily: "ui-monospace, SFMono-Regular, monospace",
    fontWeight: 600,
    borderRadius: 4,
    whiteSpace: "nowrap" as const,
  };

  if (variant === "hot") {
    return (
      <span
        className={`hot-badge ${className}`}
        style={{
          ...baseStyle,
          fontSize: "0.65rem",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          padding: "2px 8px",
        }}
      >
        {children}
      </span>
    );
  }

  if (variant === "category") {
    return (
      <span
        className={`category-badge ${className}`}
        style={baseStyle}
      >
        {children}
      </span>
    );
  }

  if (variant === "status") {
    const status = dataStatus ?? "open";
    return (
      <span
        data-status={status}
        className={className}
        style={{
          ...baseStyle,
          ...statusStyles[status],
          fontSize: "0.65rem",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          padding: "2px 8px",
        }}
      >
        {children}
      </span>
    );
  }

  if (variant === "live") {
    return (
      <span
        className={className}
        style={{
          ...baseStyle,
          background: "rgba(255, 68, 68, 0.12)",
          border: "1px solid rgba(255, 68, 68, 0.3)",
          color: "#ff4444",
          fontSize: "0.65rem",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          padding: "2px 8px",
        }}
      >
        <span className="live-dot" aria-hidden="true" />
        {children}
      </span>
    );
  }

  // chain
  return (
    <span
      className={className}
      style={{
        ...baseStyle,
        background: "rgba(0, 82, 255, 0.15)",
        border: "1px solid rgba(0, 82, 255, 0.3)",
        color: "#4488ff",
        fontSize: "0.65rem",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        padding: "2px 8px",
      }}
    >
      {children}
    </span>
  );
}
