"use client";

interface StatsBarProps {
  volume24h?: number;
  totalDistributed?: number;
  activeBettors?: number;
  marketsResolved?: number;
}

export default function StatsBar({
  volume24h = 0,
  totalDistributed = 0,
  activeBettors = 0,
  marketsResolved = 0,
}: StatsBarProps) {
  const stats = [
    { label: "VOL 24H", value: volume24h >= 1000 ? `$${(volume24h / 1000).toFixed(1)}K` : volume24h > 0 ? `$${volume24h.toFixed(0)}` : "—", color: "#00ff88" },
    { label: "DISTRIBUTED", value: `${totalDistributed.toFixed(1)} ETH`, color: "#ffd700" },
    { label: "ACTIVE BETTORS", value: activeBettors.toLocaleString(), color: "#00aaff" },
    { label: "MARKETS RESOLVED", value: marketsResolved.toLocaleString(), color: "#aaa" },
  ];

  return (
    <div
      className="flex items-center md:justify-center gap-0 overflow-x-auto scrollbar-none"
      style={{
        background: "#0d0d0d",
        borderBottom: "1px solid #1a1a1a",
        minHeight: 36,
        scrollSnapType: "x mandatory",
        WebkitOverflowScrolling: "touch",
      }}
    >
      {stats.map((stat, i) => (
        <div
          key={stat.label}
          className="flex items-center gap-2 px-4 py-2 shrink-0"
          style={{
            borderRight: i < stats.length - 1 ? "1px solid #1a1a1a" : "none",
            scrollSnapAlign: "start",
          }}
        >
          <span
            className="text-xs tracking-widest"
            style={{ color: "#444", fontFamily: "monospace" }}
          >
            {stat.label}
          </span>
          <span
            className="text-xs font-bold tabular"
            style={{ color: stat.color, fontFamily: "monospace" }}
          >
            {stat.value}
          </span>
        </div>
      ))}
    </div>
  );
}
