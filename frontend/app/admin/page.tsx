"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import Header from "@/components/Header";
import Link from "next/link";
import { ArrowLeft, RefreshCw, X, ChevronDown, ChevronUp } from "lucide-react";
import { FACTORY_ADDRESS, FACTORY_ABI, MARKET_ABI, MARKET_STATES } from "@/lib/contracts";
import type { AuditEvent } from "@/lib/audit";
import type { MarketRecord } from "@/lib/ledger";

// ─── Access control ───────────────────────────────────────────────────────────

const ADMIN_ADDRESSES = [
  "0xdd12D83786C2BAc7be3D59869834C23E91449A2D",
].map((a) => a.toLowerCase());

// ─── Types ────────────────────────────────────────────────────────────────────

interface HealthData {
  status: "ok" | "degraded" | "down";
  redis: boolean;
  oracleUrl: string | null;
  lastRound: { timestamp: number; count: number; ago: string } | null;
  uptime: string;
  version: string;
}

interface PlatformStats {
  totalVolume: number;
  marketsResolved: number;
  uniqueBettors: number;
  feesDistributed: number;
  avgPoolSize: number;
  biggestRound: number;
  avgBettorsPerRound: number;
  volume24h: number;
}

interface ChatMsg {
  id: string;
  username: string;
  address: string;
  color: string;
  text: string;
  timestamp: number;
}

// ─── Shared style constants ───────────────────────────────────────────────────

const MONO: React.CSSProperties = { fontFamily: "ui-monospace, SFMono-Regular, monospace" };

const CARD: React.CSSProperties = {
  background: "#111",
  border: "1px solid #1a1a1a",
  borderRadius: 8,
};

const SECTION_LABEL: React.CSSProperties = {
  ...MONO,
  color: "#555",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.14em",
  marginBottom: 12,
};

// ─── Utility helpers ──────────────────────────────────────────────────────────

function shortAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}

function fmtTime(ts: number): string {
  if (!ts) return "--";
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function fmtEth(val: string | number | null | undefined): string {
  if (val === null || val === undefined || val === "") return "0.000";
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(n)) return "0.000";
  return n.toFixed(4);
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, { bg: string; color: string }> = {
    ok: { bg: "rgba(0,255,136,0.12)", color: "#00ff88" },
    degraded: { bg: "rgba(255,215,0,0.12)", color: "#ffd700" },
    down: { bg: "rgba(255,68,68,0.12)", color: "#ff4444" },
    OPEN: { bg: "rgba(0,255,136,0.12)", color: "#00ff88" },
    LOCKED: { bg: "rgba(255,170,0,0.12)", color: "#ffaa00" },
    RESOLVED: { bg: "rgba(0,170,255,0.12)", color: "#00aaff" },
    CANCELLED: { bg: "rgba(255,68,68,0.12)", color: "#ff4444" },
    open: { bg: "rgba(0,255,136,0.12)", color: "#00ff88" },
    locked: { bg: "rgba(255,170,0,0.12)", color: "#ffaa00" },
    resolved: { bg: "rgba(0,170,255,0.12)", color: "#00aaff" },
    cancelled: { bg: "rgba(255,68,68,0.12)", color: "#ff4444" },
  };
  const s = colorMap[status] ?? { bg: "rgba(100,100,100,0.12)", color: "#888" };
  return (
    <span
      style={{
        ...MONO,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.1em",
        padding: "2px 7px",
        borderRadius: 4,
        background: s.bg,
        color: s.color,
        border: `1px solid ${s.color}33`,
        whiteSpace: "nowrap",
      }}
    >
      {status.toUpperCase()}
    </span>
  );
}

// ─── Audit event color ────────────────────────────────────────────────────────

function auditEventColor(event: string): string {
  switch (event) {
    case "market_created": return "#00aaff";
    case "market_resolved": return "#00ff88";
    case "market_cancelled": return "#ff4444";
    case "evidence_stored": return "#aa88ff";
    case "bet_placed": return "#ffd700";
    case "winnings_claimed": return "#ff8844";
    default: return "#888";
  }
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section aria-label={label} style={{ marginBottom: 32 }}>
      <div style={SECTION_LABEL}>{label}</div>
      {children}
    </section>
  );
}

// ─── Confirm dialog ───────────────────────────────────────────────────────────

interface ConfirmDialogProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ message, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Confirm action"
    >
      <div
        style={{
          ...CARD,
          padding: 28,
          maxWidth: 420,
          width: "90%",
          boxShadow: "0 0 40px rgba(0,0,0,0.8)",
        }}
      >
        <div
          style={{
            ...MONO,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.14em",
            color: "#ff4444",
            marginBottom: 12,
          }}
        >
          CONFIRM ACTION
        </div>
        <p style={{ ...MONO, color: "#e0e0e0", fontSize: 13, lineHeight: 1.6, marginBottom: 24 }}>
          {message}
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={onConfirm}
            style={{
              ...MONO,
              flex: 1,
              padding: "9px 16px",
              background: "rgba(255,68,68,0.12)",
              border: "1px solid rgba(255,68,68,0.4)",
              color: "#ff4444",
              fontSize: 12,
              fontWeight: 700,
              borderRadius: 6,
              cursor: "pointer",
              letterSpacing: "0.08em",
            }}
          >
            CONFIRM
          </button>
          <button
            onClick={onCancel}
            style={{
              ...MONO,
              flex: 1,
              padding: "9px 16px",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid #2a2a2a",
              color: "#888",
              fontSize: 12,
              fontWeight: 700,
              borderRadius: 6,
              cursor: "pointer",
              letterSpacing: "0.08em",
            }}
          >
            CANCEL
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Section 1: System Health ─────────────────────────────────────────────────

function HealthSection() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/health");
      const data = await res.json();
      setHealth(data);
    } catch {
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 15_000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  const statusColorMap = {
    ok: "#00ff88",
    degraded: "#ffd700",
    down: "#ff4444",
  };
  const statusColor = health ? statusColorMap[health.status] : "#555";

  return (
    <Section label="SYSTEM HEALTH">
      <div
        style={{
          ...CARD,
          padding: 20,
          display: "flex",
          flexWrap: "wrap",
          gap: 24,
          alignItems: "center",
        }}
      >
        {/* Big status indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: statusColor,
              boxShadow: `0 0 10px ${statusColor}88`,
              flexShrink: 0,
            }}
            aria-hidden="true"
          />
          <div>
            <div
              style={{
                ...MONO,
                fontSize: 22,
                fontWeight: 900,
                color: statusColor,
                lineHeight: 1,
                textShadow: `0 0 14px ${statusColor}55`,
              }}
            >
              {loading ? "CHECKING..." : health ? health.status.toUpperCase() : "UNKNOWN"}
            </div>
            <div style={{ ...MONO, fontSize: 10, color: "#555", marginTop: 3 }}>
              SYSTEM STATUS
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 20, flex: 1 }}>
          <HealthCell label="REDIS" value={health ? (health.redis ? "CONNECTED" : "DISCONNECTED") : "--"} color={health?.redis ? "#00ff88" : "#ff4444"} />
          <HealthCell label="ORACLE URL" value={health?.oracleUrl || "not set"} color={health?.oracleUrl ? "#00aaff" : "#666"} />
          <HealthCell label="UPTIME" value={health?.uptime || "--"} color="#aaa" />
          <HealthCell label="VERSION" value={health?.version || "--"} color="#aaa" />
          {health?.lastRound && (
            <>
              <HealthCell label="LAST ROUND" value={`${health.lastRound.ago} ago`} color="#ffd700" />
              <HealthCell label="LAST COUNT" value={String(health.lastRound.count)} color="#ffd700" />
            </>
          )}
        </div>

        <button
          onClick={fetchHealth}
          disabled={loading}
          aria-label="Refresh health status"
          style={{
            ...MONO,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "7px 14px",
            background: "rgba(0,255,136,0.07)",
            border: "1px solid rgba(0,255,136,0.2)",
            color: "#00ff88",
            fontSize: 11,
            fontWeight: 700,
            borderRadius: 6,
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.5 : 1,
            letterSpacing: "0.08em",
            flexShrink: 0,
          }}
        >
          <RefreshCw size={12} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
          REFRESH
        </button>
      </div>
    </Section>
  );
}

function HealthCell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{ ...MONO, fontSize: 9, color: "#444", letterSpacing: "0.1em", marginBottom: 3 }}>{label}</div>
      <div style={{ ...MONO, fontSize: 12, color, fontWeight: 700, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {value}
      </div>
    </div>
  );
}

// ─── Section 3: Active Markets ────────────────────────────────────────────────

function ActiveMarketsSection() {
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [cancelSuccess, setCancelSuccess] = useState<Record<string, boolean>>({});

  const { data: activeMarkets, isLoading, refetch } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    functionName: "getActiveMarkets",
  });

  const { writeContract, data: cancelTxHash, isPending: isCancelPending, error: cancelError } = useWriteContract();

  const { isLoading: isWaitingTx, isSuccess: isTxSuccess } = useWaitForTransactionReceipt({
    hash: cancelTxHash,
  });

  useEffect(() => {
    if (isTxSuccess && confirmCancel) {
      setCancelSuccess((prev) => ({ ...prev, [confirmCancel]: true }));
      refetch();
    }
  }, [isTxSuccess, confirmCancel, refetch]);

  function handleCancelConfirm(marketAddress: string) {
    writeContract({
      address: marketAddress as `0x${string}`,
      abi: MARKET_ABI,
      functionName: "cancelMarket",
    });
    setConfirmCancel(null);
  }

  const markets = (activeMarkets as `0x${string}`[] | undefined) ?? [];

  return (
    <Section label="ACTIVE MARKETS">
      {confirmCancel && (
        <ConfirmDialog
          message="Are you sure? This will cancel the market and allow all bettors to claim a full refund. This action is irreversible."
          onConfirm={() => handleCancelConfirm(confirmCancel)}
          onCancel={() => setConfirmCancel(null)}
        />
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <button
          onClick={() => refetch()}
          style={{
            ...MONO,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid #2a2a2a",
            color: "#666",
            fontSize: 11,
            fontWeight: 700,
            borderRadius: 6,
            cursor: "pointer",
            letterSpacing: "0.08em",
          }}
        >
          <RefreshCw size={11} />
          REFRESH
        </button>
      </div>

      {isLoading ? (
        <LoadingRow />
      ) : markets.length === 0 ? (
        <EmptyState message="No active markets on-chain" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {markets.map((addr) => (
            <ActiveMarketRow
              key={addr}
              address={addr}
              onCancel={() => setConfirmCancel(addr)}
              isCancelling={(isCancelPending || isWaitingTx) && confirmCancel === null}
              cancelSuccess={!!cancelSuccess[addr]}
              cancelError={cancelError?.message ?? null}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

function ActiveMarketRow({
  address,
  onCancel,
  isCancelling,
  cancelSuccess,
  cancelError,
}: {
  address: `0x${string}`;
  onCancel: () => void;
  isCancelling: boolean;
  cancelSuccess: boolean;
  cancelError: string | null;
}) {
  const { data: stateRaw } = useReadContract({ address, abi: MARKET_ABI, functionName: "state" });
  const { data: totalPoolRaw } = useReadContract({ address, abi: MARKET_ABI, functionName: "totalPool" });
  const { data: lockTimeRaw } = useReadContract({ address, abi: MARKET_ABI, functionName: "lockTime" });
  const { data: totalBettors } = useReadContract({ address, abi: MARKET_ABI, functionName: "totalBettors" });

  const stateNum = typeof stateRaw === "number" ? stateRaw : Number(stateRaw ?? 0);
  const stateLabel = MARKET_STATES[stateNum] ?? "UNKNOWN";
  const totalPoolEth = totalPoolRaw
    ? (Number(totalPoolRaw as bigint) / 1e18).toFixed(4)
    : "0.0000";
  const lockTimeFmt = lockTimeRaw
    ? fmtTime(Number(lockTimeRaw as bigint) * 1000)
    : "--";
  const bettors = totalBettors ? String(totalBettors as bigint) : "0";

  return (
    <div
      style={{
        ...CARD,
        padding: "14px 18px",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 16,
      }}
    >
      <div style={{ flex: "1 1 180px", minWidth: 0 }}>
        <div style={{ ...MONO, fontSize: 11, color: "#555", marginBottom: 3 }}>ADDRESS</div>
        <a
          href={`https://basescan.org/address/${address}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ ...MONO, fontSize: 12, color: "#00aaff", textDecoration: "none", fontWeight: 700 }}
        >
          {shortAddr(address)}
        </a>
      </div>

      <div style={{ flex: "0 0 auto" }}>
        <StatusBadge status={stateLabel} />
      </div>

      <div style={{ flex: "1 1 100px", minWidth: 0 }}>
        <div style={{ ...MONO, fontSize: 11, color: "#555", marginBottom: 3 }}>POOL</div>
        <div style={{ ...MONO, fontSize: 13, color: "#00ff88", fontWeight: 700 }}>{totalPoolEth} ETH</div>
      </div>

      <div style={{ flex: "1 1 140px", minWidth: 0 }}>
        <div style={{ ...MONO, fontSize: 11, color: "#555", marginBottom: 3 }}>LOCK TIME</div>
        <div style={{ ...MONO, fontSize: 12, color: "#aaa" }}>{lockTimeFmt}</div>
      </div>

      <div style={{ flex: "0 0 60px" }}>
        <div style={{ ...MONO, fontSize: 11, color: "#555", marginBottom: 3 }}>BETTORS</div>
        <div style={{ ...MONO, fontSize: 13, color: "#e0e0e0", fontWeight: 700 }}>{bettors}</div>
      </div>

      <div style={{ flex: "0 0 auto" }}>
        {cancelSuccess ? (
          <span style={{ ...MONO, fontSize: 11, color: "#00ff88" }}>CANCELLED</span>
        ) : (
          <button
            onClick={onCancel}
            disabled={isCancelling}
            aria-label={`Cancel market ${shortAddr(address)}`}
            style={{
              ...MONO,
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "6px 12px",
              background: "rgba(255,68,68,0.1)",
              border: "1px solid rgba(255,68,68,0.3)",
              color: "#ff4444",
              fontSize: 11,
              fontWeight: 700,
              borderRadius: 6,
              cursor: isCancelling ? "not-allowed" : "pointer",
              opacity: isCancelling ? 0.5 : 1,
              letterSpacing: "0.07em",
            }}
          >
            <X size={11} />
            CANCEL MARKET
          </button>
        )}
        {cancelError && (
          <div style={{ ...MONO, fontSize: 10, color: "#ff4444", marginTop: 4, maxWidth: 200, wordBreak: "break-all" }}>
            {cancelError.slice(0, 80)}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Section 4: Recent Markets (Ledger) ──────────────────────────────────────

function LedgerSection() {
  const [markets, setMarkets] = useState<MarketRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedAddr, setExpandedAddr] = useState<string | null>(null);
  const [auditByMarket, setAuditByMarket] = useState<Record<string, AuditEvent[]>>({});

  const fetchLedger = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ledger?limit=20");
      const data = await res.json();
      setMarkets(data.markets ?? []);
    } catch {
      setMarkets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLedger();
    const interval = setInterval(fetchLedger, 30_000);
    return () => clearInterval(interval);
  }, [fetchLedger]);

  async function handleRowExpand(addr: string) {
    if (expandedAddr === addr) {
      setExpandedAddr(null);
      return;
    }
    setExpandedAddr(addr);
    if (!auditByMarket[addr]) {
      try {
        const res = await fetch(`/api/audit?market=${addr}`);
        const data = await res.json();
        setAuditByMarket((prev) => ({ ...prev, [addr]: data.events ?? [] }));
      } catch {
        setAuditByMarket((prev) => ({ ...prev, [addr]: [] }));
      }
    }
  }

  return (
    <Section label="RECENT MARKETS — LEDGER">
      {loading ? (
        <LoadingRow />
      ) : markets.length === 0 ? (
        <EmptyState message="No markets in ledger yet" />
      ) : (
        <div style={{ ...CARD, overflow: "hidden" }}>
          {/* Table header */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "150px 90px 60px 80px 90px 60px 160px 70px 26px",
              gap: 0,
              padding: "10px 16px",
              background: "#0d0d0d",
              borderBottom: "1px solid #1a1a1a",
            }}
          >
            {["ADDRESS", "STATE", "COUNT", "THRESH", "POOL", "BETTORS", "RESOLVED", "EVIDENCE", ""].map((h) => (
              <span key={h} style={{ ...MONO, fontSize: 9, color: "#444", fontWeight: 700, letterSpacing: "0.1em" }}>
                {h}
              </span>
            ))}
          </div>

          {markets.map((m, i) => (
            <LedgerRow
              key={m.address}
              market={m}
              index={i}
              isExpanded={expandedAddr === m.address}
              auditEvents={auditByMarket[m.address]}
              onToggle={() => handleRowExpand(m.address)}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

function LedgerRow({
  market,
  index,
  isExpanded,
  auditEvents,
  onToggle,
}: {
  market: MarketRecord;
  index: number;
  isExpanded: boolean;
  auditEvents: AuditEvent[] | undefined;
  onToggle: () => void;
}) {
  const rowBg = index % 2 === 0 ? "#111" : "#0e0e0e";
  const hasEvidence = !!market.evidence;
  return (
    <>
      <button
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? "Collapse" : "Expand"} market ${shortAddr(market.address)}`}
        style={{
          display: "grid",
          gridTemplateColumns: "150px 90px 60px 80px 90px 60px 160px 70px 26px",
          gap: 0,
          padding: "11px 16px",
          background: isExpanded ? "#161616" : rowBg,
          borderBottom: "1px solid #1a1a1a",
          width: "100%",
          textAlign: "left",
          cursor: "pointer",
          border: "none",
          outline: isExpanded ? `1px solid #1e1e1e` : "none",
        }}
      >
        <span style={{ ...MONO, fontSize: 11, color: "#00aaff", fontWeight: 700 }}>
          {shortAddr(market.address)}
        </span>
        <span><StatusBadge status={market.state} /></span>
        <span style={{ ...MONO, fontSize: 12, color: "#e0e0e0" }}>
          {market.actualCount !== null && market.actualCount !== undefined ? market.actualCount : "--"}
        </span>
        <span style={{ ...MONO, fontSize: 12, color: "#ffd700" }}>
          {market.threshold ?? "--"}
        </span>
        <span style={{ ...MONO, fontSize: 12, color: "#00ff88" }}>
          {fmtEth(market.totalPool)} ETH
        </span>
        <span style={{ ...MONO, fontSize: 12, color: "#aaa" }}>
          {market.totalBettors ?? 0}
        </span>
        <span style={{ ...MONO, fontSize: 11, color: "#666" }}>
          {market.resolvedAt ? fmtTime(market.resolvedAt) : "--"}
        </span>
        <span style={{ ...MONO, fontSize: 10, color: hasEvidence ? "#aa88ff" : "#333" }}>
          {hasEvidence ? "YES" : "NO"}
        </span>
        <span style={{ color: "#555", display: "flex", alignItems: "center" }}>
          {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </span>
      </button>

      {isExpanded && (
        <div
          style={{
            background: "#0c0c0c",
            borderBottom: "1px solid #1a1a1a",
            padding: "16px 20px",
          }}
        >
          <div style={{ ...MONO, fontSize: 10, color: "#555", letterSpacing: "0.1em", marginBottom: 10 }}>
            AUDIT TRAIL — {shortAddr(market.address)}
          </div>
          {!auditEvents ? (
            <div style={{ ...MONO, fontSize: 11, color: "#555" }}>Loading...</div>
          ) : auditEvents.length === 0 ? (
            <div style={{ ...MONO, fontSize: 11, color: "#555" }}>No audit events for this market.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {auditEvents.map((ev, j) => (
                <AuditEventRow key={j} event={ev} />
              ))}
            </div>
          )}
          <div style={{ marginTop: 14, display: "flex", gap: 12, flexWrap: "wrap" }}>
            {market.txHashCreate && (
              <a
                href={`https://basescan.org/tx/${market.txHashCreate}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...MONO, fontSize: 10, color: "#00aaff", textDecoration: "none" }}
              >
                CREATE TX: {market.txHashCreate.slice(0, 14)}...
              </a>
            )}
            {market.txHashResolve && (
              <a
                href={`https://basescan.org/tx/${market.txHashResolve}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...MONO, fontSize: 10, color: "#00ff88", textDecoration: "none" }}
              >
                RESOLVE TX: {market.txHashResolve.slice(0, 14)}...
              </a>
            )}
            <a
              href={`https://basescan.org/address/${market.address}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...MONO, fontSize: 10, color: "#888", textDecoration: "none" }}
            >
              VIEW ON BASESCAN
            </a>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Section 5: Global Audit Trail ───────────────────────────────────────────

function AuditTrailSection() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAudit = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/audit?limit=50");
      const data = await res.json();
      setEvents(data.events ?? []);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAudit();
    const interval = setInterval(fetchAudit, 30_000);
    return () => clearInterval(interval);
  }, [fetchAudit]);

  return (
    <Section label="GLOBAL AUDIT TRAIL">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {[
            { event: "market_created", label: "CREATED" },
            { event: "market_resolved", label: "RESOLVED" },
            { event: "market_cancelled", label: "CANCELLED" },
            { event: "evidence_stored", label: "EVIDENCE" },
            { event: "bet_placed", label: "BET" },
          ].map(({ event, label }) => (
            <div key={event} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: auditEventColor(event) }} aria-hidden="true" />
              <span style={{ ...MONO, fontSize: 9, color: "#555" }}>{label}</span>
            </div>
          ))}
        </div>
        <button
          onClick={fetchAudit}
          disabled={loading}
          style={{
            ...MONO,
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 10px",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid #2a2a2a",
            color: "#666",
            fontSize: 10,
            fontWeight: 700,
            borderRadius: 5,
            cursor: loading ? "not-allowed" : "pointer",
            letterSpacing: "0.07em",
          }}
        >
          <RefreshCw size={10} />
          REFRESH
        </button>
      </div>

      {loading ? (
        <LoadingRow />
      ) : events.length === 0 ? (
        <EmptyState message="No audit events yet" />
      ) : (
        <div style={{ ...CARD, padding: "10px 0", maxHeight: 480, overflowY: "auto" }}>
          {events.map((ev, i) => (
            <AuditEventRow key={i} event={ev} showBorder={i < events.length - 1} />
          ))}
        </div>
      )}
    </Section>
  );
}

function AuditEventRow({ event, showBorder = true }: { event: AuditEvent; showBorder?: boolean }) {
  const color = auditEventColor(event.event);
  const dataKeys = Object.keys(event.data ?? {}).filter((k) => event.data[k] !== null && event.data[k] !== undefined);

  return (
    <div
      style={{
        padding: "10px 16px",
        borderBottom: showBorder ? "1px solid #161616" : "none",
        display: "grid",
        gridTemplateColumns: "160px 160px 1fr",
        gap: 12,
        alignItems: "start",
      }}
    >
      <div>
        <div style={{ ...MONO, fontSize: 10, color: "#444", marginBottom: 2 }}>
          {fmtTime(event.timestamp)}
        </div>
        <div style={{ ...MONO, fontSize: 9, color: "#333" }}>
          src: {event.source}
        </div>
      </div>
      <div>
        <span
          style={{
            ...MONO,
            fontSize: 10,
            fontWeight: 700,
            color,
            background: `${color}14`,
            border: `1px solid ${color}33`,
            padding: "2px 6px",
            borderRadius: 4,
          }}
        >
          {event.event.replace(/_/g, " ").toUpperCase()}
        </span>
        <div style={{ ...MONO, fontSize: 10, color: "#00aaff", marginTop: 4 }}>
          {shortAddr(event.marketAddress)}
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 12px" }}>
        {dataKeys.slice(0, 6).map((k) => (
          <div key={k} style={{ ...MONO, fontSize: 10 }}>
            <span style={{ color: "#444" }}>{k}: </span>
            <span style={{ color: "#999" }}>
              {String(event.data[k]).slice(0, 30)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Section 6: Platform Stats ────────────────────────────────────────────────

function PlatformStatsSection() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/stats");
      const data = await res.json();
      setStats(data);
    } catch {
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30_000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  const cards = stats
    ? [
        { label: "TOTAL VOLUME", value: `${stats.totalVolume.toFixed(3)} ETH`, color: "#00ff88" },
        { label: "MARKETS RESOLVED", value: String(stats.marketsResolved), color: "#ffd700" },
        { label: "UNIQUE BETTORS", value: String(stats.uniqueBettors), color: "#00aaff" },
        { label: "FEES DISTRIBUTED", value: `${stats.feesDistributed.toFixed(4)} ETH`, color: "#aa88ff" },
        { label: "AVG POOL SIZE", value: `${stats.avgPoolSize.toFixed(4)} ETH`, color: "#ff8844" },
        { label: "BIGGEST ROUND", value: `${stats.biggestRound.toFixed(4)} ETH`, color: "#ff4444" },
        { label: "AVG BETTORS / ROUND", value: String(stats.avgBettorsPerRound), color: "#aaa" },
        { label: "24H VOLUME", value: `${stats.volume24h.toFixed(4)} ETH`, color: "#00ff88" },
      ]
    : [];

  return (
    <Section label="PLATFORM STATS">
      {loading ? (
        <LoadingRow />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: 10,
          }}
        >
          {cards.map((c) => (
            <div key={c.label} style={{ ...CARD, padding: "14px 16px" }}>
              <div style={{ ...MONO, fontSize: 9, color: "#444", letterSpacing: "0.1em", marginBottom: 6 }}>
                {c.label}
              </div>
              <div
                style={{
                  ...MONO,
                  fontSize: 18,
                  fontWeight: 900,
                  color: c.color,
                  textShadow: `0 0 12px ${c.color}44`,
                }}
              >
                {c.value}
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ─── Section 7: Chat Moderation ───────────────────────────────────────────────

function ChatModerationSection() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(true);
  const [onlineCount, setOnlineCount] = useState<number>(0);

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/chat/messages?limit=100");
      const data = await res.json();
      const msgs: ChatMsg[] = data.messages ?? [];
      setMessages(msgs);
      // Online = messages in last 5 minutes
      const fiveMinAgo = Date.now() - 5 * 60 * 1000;
      const uniqueAddrs = new Set(
        msgs
          .filter((m) => m.timestamp > fiveMinAgo && m.address)
          .map((m) => m.address.toLowerCase()),
      );
      setOnlineCount(uniqueAddrs.size);
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, 20_000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  return (
    <Section label="CHAT MODERATION">
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
        <div style={{ ...MONO, fontSize: 12, color: "#aaa" }}>
          <span style={{ color: "#00ff88", fontWeight: 700 }}>{onlineCount}</span> active in last 5 min
        </div>
        <div style={{ ...MONO, fontSize: 12, color: "#555" }}>
          {messages.length} messages loaded
        </div>
        <button
          onClick={fetchMessages}
          style={{
            ...MONO,
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 10px",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid #2a2a2a",
            color: "#666",
            fontSize: 10,
            fontWeight: 700,
            borderRadius: 5,
            cursor: "pointer",
            letterSpacing: "0.07em",
          }}
        >
          <RefreshCw size={10} />
          REFRESH
        </button>
      </div>

      {loading ? (
        <LoadingRow />
      ) : messages.length === 0 ? (
        <EmptyState message="No chat messages" />
      ) : (
        <div
          style={{
            ...CARD,
            maxHeight: 440,
            overflowY: "auto",
            padding: "8px 0",
          }}
        >
          {[...messages].reverse().map((msg, i) => (
            <div
              key={msg.id}
              style={{
                padding: "9px 16px",
                background: i % 2 === 0 ? "#111" : "#0e0e0e",
                borderBottom: i < messages.length - 1 ? "1px solid #161616" : "none",
                display: "grid",
                gridTemplateColumns: "170px 130px 1fr",
                gap: 12,
                alignItems: "start",
              }}
            >
              <div>
                <div style={{ ...MONO, fontSize: 10, color: "#444" }}>
                  {fmtTime(msg.timestamp)}
                </div>
              </div>
              <div>
                <span
                  style={{
                    ...MONO,
                    fontSize: 11,
                    fontWeight: 700,
                    color: msg.color || "#888",
                  }}
                >
                  {msg.username || "anon"}
                </span>
                {msg.address && (
                  <div style={{ ...MONO, fontSize: 9, color: "#444", marginTop: 1 }}>
                    {shortAddr(msg.address)}
                  </div>
                )}
              </div>
              <div style={{ ...MONO, fontSize: 12, color: "#ccc", lineHeight: 1.5, wordBreak: "break-word" }}>
                {msg.text}
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ─── Shared micro-components ──────────────────────────────────────────────────

function LoadingRow() {
  return (
    <div
      style={{
        ...CARD,
        padding: "20px 16px",
        ...MONO,
        fontSize: 12,
        color: "#555",
        textAlign: "center",
      }}
    >
      Loading...
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div
      style={{
        ...CARD,
        padding: "20px 16px",
        ...MONO,
        fontSize: 12,
        color: "#444",
        textAlign: "center",
      }}
    >
      {message}
    </div>
  );
}

// ─── Access denied screen ─────────────────────────────────────────────────────

function AccessDenied({ isConnected }: { isConnected: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        gap: 16,
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "rgba(255,68,68,0.1)",
          border: "1px solid rgba(255,68,68,0.3)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        aria-hidden="true"
      >
        <X size={24} color="#ff4444" />
      </div>
      <div
        style={{
          ...MONO,
          fontSize: 20,
          fontWeight: 900,
          color: "#ff4444",
          letterSpacing: "0.15em",
          textShadow: "0 0 16px rgba(255,68,68,0.4)",
        }}
      >
        ACCESS DENIED
      </div>
      <div style={{ ...MONO, fontSize: 13, color: "#555", textAlign: "center", maxWidth: 320 }}>
        {isConnected
          ? "Connected wallet is not an admin address."
          : "Connect admin wallet to access this panel."}
      </div>
      <Link
        href="/"
        style={{
          ...MONO,
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginTop: 8,
          padding: "8px 18px",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid #2a2a2a",
          color: "#666",
          fontSize: 12,
          fontWeight: 700,
          borderRadius: 6,
          textDecoration: "none",
          letterSpacing: "0.07em",
        }}
      >
        <ArrowLeft size={12} />
        BACK TO APP
      </Link>
    </div>
  );
}

// ─── Admin page ───────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { address, isConnected } = useAccount();
  const isAdmin = isConnected && !!address && ADMIN_ADDRESSES.includes(address.toLowerCase());

  return (
    <div style={{ background: "#0a0a0a", color: "#e0e0e0", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Header />

      <main style={{ flex: 1, padding: "24px 16px", maxWidth: 1200, width: "100%", margin: "0 auto" }}>

        {/* Page heading */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
          <Link
            href="/"
            style={{
              ...MONO,
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11,
              color: "#555",
              textDecoration: "none",
              transition: "color 0.15s",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "#00ff88")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "#555")}
          >
            <ArrowLeft size={12} />
            BACK
          </Link>
          <span style={{ color: "#2a2a2a" }}>/</span>
          <div>
            <span
              style={{
                ...MONO,
                fontSize: 14,
                fontWeight: 900,
                color: "#e0e0e0",
                letterSpacing: "0.12em",
              }}
            >
              ADMIN PANEL
            </span>
            {isAdmin && address && (
              <span
                style={{
                  ...MONO,
                  marginLeft: 12,
                  fontSize: 10,
                  color: "#00ff88",
                  background: "rgba(0,255,136,0.08)",
                  border: "1px solid rgba(0,255,136,0.2)",
                  padding: "2px 8px",
                  borderRadius: 4,
                }}
              >
                {shortAddr(address)}
              </span>
            )}
          </div>
        </div>

        {!isAdmin ? (
          <AccessDenied isConnected={isConnected} />
        ) : (
          <>
            <HealthSection />
            <ActiveMarketsSection />
            <LedgerSection />
            <AuditTrailSection />
            <PlatformStatsSection />
            <ChatModerationSection />
          </>
        )}
      </main>

      {/* Minimal footer */}
      <footer style={{ borderTop: "1px solid #1a1a1a", padding: "12px 16px", textAlign: "center" }}>
        <span style={{ ...MONO, fontSize: 10, color: "#333" }}>
          RUSH ADMIN — {new Date().toISOString().slice(0, 10)}
        </span>
      </footer>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
