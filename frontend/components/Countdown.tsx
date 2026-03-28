"use client";

interface CountdownProps {
  timeLeft: number;
  totalDuration: number;
  status: "open" | "locked" | "resolving" | "resolved";
}

export default function Countdown({ timeLeft, totalDuration, status }: CountdownProps) {
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  const progress = totalDuration > 0 ? Math.max(0, timeLeft / totalDuration) : 0;
  const isUrgent = timeLeft <= 30 && status === "open";
  const pct = Math.round((1 - progress) * 100);

  if (status === "resolving") {
    return (
      <div
        className="flex items-center gap-2 px-3 py-1.5 rounded"
        style={{ background: "rgba(255,170,0,0.1)", border: "1px solid rgba(255,170,0,0.2)" }}
      >
        <div
          className="w-2 h-2 rounded-full"
          style={{
            background: "#ffaa00",
            animation: "pulse 0.8s ease-in-out infinite",
            boxShadow: "0 0 8px rgba(255,170,0,0.8)",
          }}
        />
        <span
          className="text-sm font-bold tracking-widest"
          style={{ color: "#ffaa00", fontFamily: "monospace" }}
        >
          RESOLVING...
        </span>
      </div>
    );
  }

  if (status === "locked") {
    return (
      <div
        className="flex items-center gap-2 px-3 py-1.5 rounded"
        style={{ background: "rgba(255,68,68,0.1)", border: "1px solid rgba(255,68,68,0.2)" }}
      >
        <span style={{ fontSize: 14 }}>🔒</span>
        <span
          className="text-sm font-bold tracking-widest"
          style={{ color: "#ff4444", fontFamily: "monospace" }}
        >
          BETTING CLOSED
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span
          className="text-xs font-medium tracking-widest"
          style={{ color: "#666", fontFamily: "monospace" }}
        >
          ROUND ENDS IN
        </span>
        <span
          className="text-xs tabular"
          style={{ color: "#555", fontFamily: "monospace" }}
        >
          {pct}%
        </span>
      </div>

      {/* Timer display */}
      <div
        className="text-2xl font-black tabular"
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          color: isUrgent ? "#ff4444" : "#e0e0e0",
          textShadow: isUrgent ? "0 0 12px rgba(255,68,68,0.6)" : "none",
          animation: isUrgent ? "pulse 0.8s ease-in-out infinite" : "none",
          letterSpacing: "0.05em",
        }}
      >
        {mm}:{ss}
      </div>

      {/* Progress bar */}
      <div
        className="relative h-1.5 rounded-full overflow-hidden"
        style={{ background: "#1a1a1a" }}
      >
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-all duration-1000"
          style={{
            width: `${(1 - progress) * 100}%`,
            background: isUrgent
              ? "linear-gradient(90deg, #ff4444, #ff8888)"
              : "linear-gradient(90deg, #00ff88, #00cc70)",
            boxShadow: isUrgent
              ? "0 0 6px rgba(255,68,68,0.5)"
              : "0 0 6px rgba(0,255,136,0.4)",
          }}
        />
      </div>
    </div>
  );
}
