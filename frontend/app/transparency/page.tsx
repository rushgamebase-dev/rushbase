"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, ChevronDown, ChevronUp, Search } from "lucide-react";
import { motion } from "framer-motion";
import Header from "@/components/Header";
import { IdentityChip } from "@/profile-kit/components/identity/IdentityChip";

// ── Types ────────────────────────────────────────────────────────────────────

interface Metrics {
  extractedAt: string;
  latestBlock: number;
  ethMarketsCreated: number;
  burnMarketsCreated: number;
  totalEthVolumeWei: string;
  totalBurnVolumeWei: string;
  totalEthWonWei: string;
  totalEthRefundedWei: string;
  uniqueEthBettors: number;
  uniqueBurnBettors: number;
  tilesV1Events: number;
  tilesV2Events: number;
  devFeesClaimedWei: string;
  totalDistributedWei: string;
  totalForeclosures: number;
  contracts: Record<string, string>;
}

interface CompactMarket {
  i: number; a: string; d: string; s: string; p: string;
  w: number; c: number; t1: string; t2: string; tx1: string; tx2: string; n: number;
}

interface BettingRow {
  w: string; m: number; b: number; wa: string; wo: string; r: string; n: string;
}

interface TilesPnlRow {
  w: string; di: string; do: string; cf: string; tp: string;
  bc: string; br: string; fc: string; at: string; n: string;
}

interface Housebot {
  address: string;
  ethWagered: string; ethWon: string; ethRefunded: string; ethNet: string;
  ethBets: number; ethMarkets: number;
  burnWagered: string; burnBets: number; burnMarkets: number;
}

interface DevClaim { t: string; c: string; a: string; tx: string; }
interface Distribution { t: string; c: string; a: string; tx: string; }
interface Foreclosure { t: string; c: string; ti: number; o: string; tx: string; }

interface TransparencyData {
  metrics: Metrics;
  housebot: Housebot;
  ethMarkets: CompactMarket[];
  burnMarkets: CompactMarket[];
  ethBetting: BettingRow[];
  burnBetting: BettingRow[];
  tilesV1Pnl: TilesPnlRow[];
  tilesV2Pnl: TilesPnlRow[];
  devClaims: DevClaim[];
  distributions: Distribution[];
  foreclosures: Foreclosure[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const BASESCAN = "https://basescan.org";
const E18 = BigInt("1000000000000000000");
const weiToEth = (v: string, decimals: number): string => {
  if (!v || v === "0") return "0.000000".slice(0, decimals + 2);
  const neg = v.startsWith("-");
  const abs = neg ? v.slice(1) : v;
  const n = BigInt(abs);
  const whole = n / E18;
  const frac = (n % E18).toString().padStart(18, "0").slice(0, decimals);
  return `${neg ? "-" : ""}${whole}.${frac}`;
};
const wei = (v: string) => weiToEth(v, 6);
const weiShort = (v: string) => weiToEth(v, 4);
const shortAddr = (a: string) => a ? `${a.slice(0, 6)}...${a.slice(-4)}` : "";
const shortTx = (t: string) => t ? `${t.slice(0, 10)}...${t.slice(-4)}` : "";

const AddrLink = ({ addr }: { addr: string }) => (
  <a href={`${BASESCAN}/address/${addr}`} target="_blank" rel="noopener noreferrer"
     style={{ color: "#00aaff", fontFamily: "monospace", fontSize: "0.8rem" }}>
    {shortAddr(addr)}
  </a>
);

// Rich wallet identity (avatar + handle/level) linking to /profile. Contract
// addresses keep using AddrLink above since they don't have a profile.
const WalletLink = ({ addr }: { addr: string }) => (
  <span className="inline-flex items-center gap-1.5">
    <IdentityChip address={addr} size="xs" />
    <a href={`${BASESCAN}/address/${addr}`} target="_blank" rel="noopener noreferrer"
       style={{ color: "#444" }} title="View on Basescan">
      <ExternalLink size={10} />
    </a>
  </span>
);

const TxLink = ({ hash }: { hash: string }) => hash ? (
  <a href={`${BASESCAN}/tx/${hash}`} target="_blank" rel="noopener noreferrer"
     style={{ color: "#00aaff", fontFamily: "monospace", fontSize: "0.75rem" }}>
    {shortTx(hash)} <ExternalLink size={9} style={{ display: "inline", verticalAlign: "middle" }} />
  </a>
) : <span style={{ color: "#333" }}>—</span>;

const stateColor = (s: string) => {
  if (s === "RESOLVED") return "#00ff88";
  if (s === "CANCELLED") return "#ff4444";
  if (s === "OPEN") return "#ffaa00";
  if (s === "LOCKED") return "#ffaa00";
  return "#666";
};

const pnlColor = (v: string) => {
  const n = Number(v);
  if (n > 0) return "#00ff88";
  if (n < 0) return "#ff4444";
  return "#666";
};

// ── Styles ───────────────────────────────────────────────────────────────────

const S = {
  page: { background: "#0a0a0a", color: "#e0e0e0", minHeight: "100vh" },
  section: { marginBottom: "3rem" },
  sectionLabel: {
    fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.14em",
    fontFamily: "monospace", color: "#555", marginBottom: "1rem",
  } as React.CSSProperties,
  card: {
    background: "#111", border: "1px solid #1a1a1a", borderRadius: "0.5rem",
    padding: "1rem",
  },
  tableWrap: {
    borderRadius: "0.5rem", border: "1px solid #1a1a1a", overflow: "hidden",
  },
  th: {
    fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.08em",
    fontFamily: "monospace", color: "#555", padding: "0.6rem 0.75rem",
    background: "#0d0d0d", borderBottom: "1px solid #1a1a1a",
    textAlign: "left" as const, whiteSpace: "nowrap" as const,
  },
  td: {
    fontSize: "0.75rem", fontFamily: "monospace", padding: "0.5rem 0.75rem",
    borderBottom: "1px solid #111", whiteSpace: "nowrap" as const,
  },
  metricValue: {
    fontSize: "1.3rem", fontWeight: 900, fontFamily: "monospace", color: "#e0e0e0",
  },
  metricLabel: {
    fontSize: "0.65rem", fontWeight: 500, fontFamily: "monospace",
    color: "#555", letterSpacing: "0.08em", marginTop: "0.25rem",
  },
};

// ── Collapsible section ──────────────────────────────────────────────────────

function Section({ id, label, title, children, defaultOpen = false }: {
  id: string; label: string; title: string;
  children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section style={S.section} id={id}>
      <div style={S.sectionLabel}>{label}</div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full text-left mb-3"
        style={{ background: "none", border: "none", cursor: "pointer", color: "#e0e0e0" }}
      >
        <span style={{ fontSize: "1.1rem", fontWeight: 700, fontFamily: "monospace" }}>{title}</span>
        {open ? <ChevronUp size={16} color="#555" /> : <ChevronDown size={16} color="#555" />}
      </button>
      {open && <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>{children}</motion.div>}
    </section>
  );
}

// ── Paginated table ──────────────────────────────────────────────────────────

function PaginatedTable<T>({ data, headers, renderRow, pageSize = 50, searchField }: {
  data: T[]; headers: string[];
  renderRow: (item: T, i: number) => React.ReactNode;
  pageSize?: number; searchField?: (item: T) => string;
}) {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search || !searchField) return data;
    const q = search.toLowerCase();
    return data.filter((item) => searchField(item).toLowerCase().includes(q));
  }, [data, search, searchField]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const slice = filtered.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <div>
      {searchField && (
        <div className="flex items-center gap-2 mb-3">
          <Search size={13} color="#555" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search address or description..."
            style={{
              background: "#111", border: "1px solid #1a1a1a", borderRadius: "0.25rem",
              padding: "0.4rem 0.6rem", color: "#e0e0e0", fontFamily: "monospace",
              fontSize: "0.75rem", width: "100%", maxWidth: "300px", outline: "none",
            }}
          />
          <span style={{ fontSize: "0.7rem", color: "#555", fontFamily: "monospace" }}>
            {filtered.length} results
          </span>
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <div style={S.tableWrap}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>{headers.map((h, i) => <th key={i} style={S.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {slice.map((item, i) => renderRow(item, page * pageSize + i))}
            </tbody>
          </table>
        </div>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-3">
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            style={{
              background: page === 0 ? "#111" : "rgba(0,255,136,0.1)",
              border: `1px solid ${page === 0 ? "#1a1a1a" : "rgba(0,255,136,0.3)"}`,
              color: page === 0 ? "#333" : "#00ff88",
              padding: "0.3rem 0.8rem", borderRadius: "0.25rem",
              fontFamily: "monospace", fontSize: "0.7rem", cursor: page === 0 ? "default" : "pointer",
            }}
          >
            PREV
          </button>
          <span style={{ fontSize: "0.7rem", fontFamily: "monospace", color: "#555" }}>
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1}
            style={{
              background: page >= totalPages - 1 ? "#111" : "rgba(0,255,136,0.1)",
              border: `1px solid ${page >= totalPages - 1 ? "#1a1a1a" : "rgba(0,255,136,0.3)"}`,
              color: page >= totalPages - 1 ? "#333" : "#00ff88",
              padding: "0.3rem 0.8rem", borderRadius: "0.25rem",
              fontFamily: "monospace", fontSize: "0.7rem", cursor: page >= totalPages - 1 ? "default" : "pointer",
            }}
          >
            NEXT
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function TransparencyPage() {
  const [data, setData] = useState<TransparencyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [marketFilter, setMarketFilter] = useState<"ALL" | "RESOLVED" | "CANCELLED">("ALL");

  useEffect(() => {
    fetch("/transparency/data.json")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => { setData(d); setLoading(false); })
      .catch((err) => { console.error("Transparency data load failed:", err); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <div style={S.page} className="flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center">
          <span style={{ fontFamily: "monospace", color: "#555" }}>Loading on-chain data...</span>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={S.page} className="flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center">
          <span style={{ fontFamily: "monospace", color: "#ff4444" }}>Failed to load transparency data.</span>
        </div>
      </div>
    );
  }

  const m = data.metrics;
  const allMarkets = [...data.ethMarkets, ...data.burnMarkets];
  const filteredMarkets = marketFilter === "ALL" ? allMarkets : allMarkets.filter((x) => x.s === marketFilter);


  return (
    <div style={S.page} className="flex flex-col">
      <Header />

      <main className="flex-1 p-4 md:p-8 max-w-6xl mx-auto w-full">

        {/* Breadcrumb */}
        <div className="flex items-center gap-3 mb-8">
          <Link href="/" className="flex items-center gap-1.5 text-xs transition-colors"
                style={{ color: "#555", fontFamily: "monospace", textDecoration: "none" }}>
            <ArrowLeft size={13} /> BACK
          </Link>
          <span style={{ color: "#333" }}>/</span>
          <span className="text-sm font-bold" style={{ color: "#e0e0e0", fontFamily: "monospace", letterSpacing: "0.1em" }}>
            TRANSPARENCY
          </span>
        </div>

        {/* Hero */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <h1 style={{ fontSize: "2rem", fontWeight: 900, fontFamily: "monospace", color: "#ffd700", marginBottom: "0.5rem" }}>
            On-Chain Transparency Report
          </h1>
          <p style={{ color: "#777", fontSize: "0.9rem", lineHeight: 1.7, maxWidth: "700px", marginBottom: "0.5rem" }}>
            Every transaction in the Rush Protocol is on-chain and verifiable. This report is generated directly from
            Base mainnet event logs — no off-chain data, no edits, no filters. Every bet, every fee, every distribution
            is documented with its transaction hash.
          </p>
          <p style={{ color: "#444", fontSize: "0.75rem", fontFamily: "monospace" }}>
            Block {m.latestBlock.toLocaleString()} &middot; {m.extractedAt.replace("T", " ").split(".")[0]} UTC
          </p>
        </motion.div>

        <div style={{ height: "2rem" }} />

        {/* ── TL;DR — Hard Facts ──────────────────────────────────── */}
        <section style={S.section}>
          <div style={S.sectionLabel}>THE NUMBERS DON&apos;T LIE</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.05 }}
              style={S.card}>
              <div style={{ fontSize: "1.8rem", fontWeight: 900, fontFamily: "monospace", color: "#e0e0e0" }}>
                +{weiShort(m.totalDistributedWei)} ETH
              </div>
              <div style={S.metricLabel}>DISTRIBUTED TO V1 HOLDERS</div>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.1 }}
              style={S.card}>
              <div style={{ fontSize: "1.8rem", fontWeight: 900, fontFamily: "monospace", color: "#e0e0e0" }}>
                {weiShort(m.devFeesClaimedWei)} ETH
              </div>
              <div style={S.metricLabel}>PROTOCOL FEES CLAIMED (V1)</div>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.15 }}
              style={S.card}>
              <div style={{ fontSize: "1.8rem", fontWeight: 900, fontFamily: "monospace", color: "#e0e0e0" }}>
                3%
              </div>
              <div style={S.metricLabel}>FOUNDER TOKEN ALLOCATION</div>
            </motion.div>
          </div>

          {/* Impact bullets */}
          <div style={{ ...S.card, borderColor: "#1a1a1a" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", fontFamily: "monospace", fontSize: "0.8rem", color: "#999" }}>
              <div className="flex gap-3">
                <span style={{ color: "#00ff88", fontWeight: 700, flexShrink: 0 }}>+{weiShort(m.totalDistributedWei)} ETH</span>
                <span>distributed to V1 tile holders from protocol fees</span>
              </div>
              <div className="flex gap-3">
                <span style={{ color: "#00ff88", fontWeight: 700, flexShrink: 0 }}>
                  +{weiShort(String(data.ethBetting.reduce((s, r) => s + (r.w === data.housebot.address ? BigInt(0) : BigInt(r.n)), BigInt(0))))} ETH
                </span>
                <span>net profit for bettors ({data.ethBetting.length - 1} wallets) — subsidized by the protocol housebot</span>
              </div>
              <div className="flex gap-3">
                <span style={{ color: "#ff4444", fontWeight: 700, flexShrink: 0 }}>{wei(data.housebot.ethNet)} ETH</span>
                <span>lost by protocol housebot providing liquidity so markets don&apos;t cancel</span>
              </div>
              <div className="flex gap-3">
                <span style={{ color: "#888", fontWeight: 700, flexShrink: 0 }}>~$4,000</span>
                <span>spent on hardware (3090Ti, 12TB NVMe, dedicated server running 24/7) <span style={{ color: "#555", fontSize: "0.7rem" }}>off-chain</span></span>
              </div>
              <div className="flex gap-3">
                <span style={{ color: "#888", fontWeight: 700, flexShrink: 0 }}>~$670</span>
                <span>spent on services (DexScreener, Vercel, Twitter/X Gold) <span style={{ color: "#555", fontSize: "0.7rem" }}>off-chain</span></span>
              </div>
              <div className="flex gap-3">
                <span style={{ color: "#ffd700", fontWeight: 700, flexShrink: 0 }}>0</span>
                <span>emergencyWithdraw calls — zero admin fund extractions, ever</span>
              </div>
              <div className="flex gap-3">
                <span style={{ color: "#ffd700", fontWeight: 700, flexShrink: 0 }}>0</span>
                <span>oracle manipulations — every market resolved by on-chain YOLO vehicle count</span>
              </div>
              <div className="flex gap-3">
                <span style={{ color: "#ffd700", fontWeight: 700, flexShrink: 0 }}>100%</span>
                <span>of cancelled markets returned full refunds to bettors</span>
              </div>
            </div>
          </div>

          <p style={{ color: "#555", fontSize: "0.75rem", fontFamily: "monospace", marginTop: "1rem", lineHeight: 1.7 }}>
            Every number above is derived from on-chain events. Click any transaction hash below to verify on Basescan.
            All contracts are open source and verified. Fee splits are hardcoded and immutable.
          </p>
        </section>

        {/* ── Key Metrics ─────────────────────────────────────────── */}
        <section style={S.section}>
          <div style={S.sectionLabel}>PROTOCOL METRICS</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { v: m.ethMarketsCreated + m.burnMarketsCreated, l: "MARKETS CREATED" },
              { v: weiShort(m.totalEthVolumeWei) + " ETH", l: "ETH VOLUME" },
              { v: m.uniqueEthBettors + m.uniqueBurnBettors, l: "UNIQUE BETTORS" },
              { v: weiShort(m.totalDistributedWei) + " ETH", l: "DISTRIBUTED TO HOLDERS" },
              { v: weiShort(m.devFeesClaimedWei) + " ETH", l: "PROTOCOL FEES CLAIMED (V1)" },
              { v: m.totalForeclosures, l: "FORECLOSURES" },
              { v: m.tilesV1Events + m.tilesV2Events, l: "TILE EVENTS" },
              { v: weiShort(m.totalBurnVolumeWei) + " RUSH", l: "RUSH VOLUME" },
            ].map((stat, i) => (
              <motion.div key={i} style={S.card}
                          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.3, delay: i * 0.05 }}>
                <div style={S.metricValue}>{typeof stat.v === "number" ? stat.v.toLocaleString() : stat.v}</div>
                <div style={S.metricLabel}>{stat.l}</div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ── Contracts ────────────────────────────────────────────�� */}
        <section style={S.section}>
          <div style={S.sectionLabel}>VERIFIED CONTRACTS</div>
          <div className="flex flex-col gap-2">
            {[
              { name: "MarketFactory (ETH)", addr: m.contracts.factory_eth, note: "Deprecated" },
              { name: "BurnMarketFactory (RUSH)", addr: m.contracts.factory_burn, note: "Production" },
              { name: "RushTiles V1 (Series 1)", addr: m.contracts.tiles_v1, note: "Production" },
              { name: "Protocol Wallet", addr: m.contracts.dev_wallet, note: "Fee recipient" },
              { name: "Oracle Wallet", addr: m.contracts.oracle_wallet, note: "Market operator" },
            ].map((c, i) => (
              <div key={i} className="flex flex-col md:flex-row md:items-center justify-between gap-1 px-4 py-3 rounded-lg"
                   style={{ background: "#111", border: "1px solid #1a1a1a" }}>
                <div className="flex items-center gap-3">
                  <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: "0.8rem", color: "#e0e0e0" }}>{c.name}</span>
                  <span style={{ fontSize: "0.65rem", color: "#555", fontFamily: "monospace" }}>{c.note}</span>
                </div>
                <a href={`${BASESCAN}/address/${c.addr}`} target="_blank" rel="noopener noreferrer"
                   className="flex items-center gap-1"
                   style={{ color: "#00aaff", fontFamily: "monospace", fontSize: "0.75rem", textDecoration: "none" }}>
                  {c.addr.slice(0, 10)}...{c.addr.slice(-8)} <ExternalLink size={10} />
                </a>
              </div>
            ))}
          </div>
        </section>

        {/* ── Fee Flow ────────────────────────────────────────────── */}
        <section style={S.section}>
          <div style={S.sectionLabel}>FEE FLOW — WHERE EVERY ETH GOES</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div style={{ ...S.card, borderColor: "#00ff8833" }}>
              <div style={{ fontSize: "0.65rem", color: "#00ff88", fontFamily: "monospace", fontWeight: 700, letterSpacing: "0.08em", marginBottom: "0.5rem" }}>
                BETTORS WIN
              </div>
              <div style={S.metricValue}>{weiShort(m.totalEthWonWei)} ETH</div>
              <div style={{ fontSize: "0.7rem", color: "#555", fontFamily: "monospace", marginTop: "0.25rem" }}>
                + {weiShort(m.totalEthRefundedWei)} ETH refunded
              </div>
            </div>
            <div style={{ ...S.card, borderColor: "#ffd70033" }}>
              <div style={{ fontSize: "0.65rem", color: "#ffd700", fontFamily: "monospace", fontWeight: 700, letterSpacing: "0.08em", marginBottom: "0.5rem" }}>
                PROTOCOL FEE RATE
              </div>
              <div style={S.metricValue}>5%</div>
              <div style={{ fontSize: "0.7rem", color: "#555", fontFamily: "monospace", marginTop: "0.25rem" }}>
                of resolved market pools → tile holders
              </div>
            </div>
            <div style={{ ...S.card, borderColor: "#00aaff33" }}>
              <div style={{ fontSize: "0.65rem", color: "#00aaff", fontFamily: "monospace", fontWeight: 700, letterSpacing: "0.08em", marginBottom: "0.5rem" }}>
                HOLDER DISTRIBUTIONS
              </div>
              <div style={S.metricValue}>{weiShort(m.totalDistributedWei)} ETH</div>
              <div style={{ fontSize: "0.7rem", color: "#555", fontFamily: "monospace", marginTop: "0.25rem" }}>
                From betting fees + tile taxes
              </div>
            </div>
          </div>
        </section>

        {/* ── Market History ──────────────────────────────────────── */}
        <Section id="markets" label="MARKET HISTORY" title={`All Markets (${allMarkets.length})`}>
          <div className="flex gap-2 mb-3">
            {(["ALL", "RESOLVED", "CANCELLED"] as const).map((f) => (
              <button key={f} onClick={() => setMarketFilter(f)}
                      style={{
                        background: marketFilter === f ? "rgba(0,255,136,0.15)" : "#111",
                        border: `1px solid ${marketFilter === f ? "rgba(0,255,136,0.4)" : "#1a1a1a"}`,
                        color: marketFilter === f ? "#00ff88" : "#555",
                        padding: "0.3rem 0.7rem", borderRadius: "0.25rem",
                        fontFamily: "monospace", fontSize: "0.65rem", cursor: "pointer",
                      }}>
                {f} ({f === "ALL" ? allMarkets.length : allMarkets.filter((x) => x.s === f).length})
              </button>
            ))}
          </div>
          <PaginatedTable
            data={filteredMarkets}
            headers={["#", "ADDRESS", "DESCRIPTION", "STATE", "POOL", "BETS", "RESULT", "CREATED", "CREATE TX", "RESOLVE TX"]}
            pageSize={50}
            searchField={(m) => `${m.a} ${m.d}`}
            renderRow={(m, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "#0e0e0e" : "#111" }}>
                <td style={S.td}>{m.i}</td>
                <td style={S.td}><AddrLink addr={m.a} /></td>
                <td style={{ ...S.td, maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", color: "#999" }}>{m.d}</td>
                <td style={S.td}><span style={{ color: stateColor(m.s), fontWeight: 700 }}>{m.s}</span></td>
                <td style={S.td}>{weiShort(m.p)}</td>
                <td style={S.td}>{m.n}</td>
                <td style={S.td}>{m.w === 0 ? "Under" : m.w === 1 ? "Over" : "—"}{m.c >= 0 ? ` (${m.c})` : ""}</td>
                <td style={{ ...S.td, color: "#777" }}>{m.t1 ? m.t1.replace(" UTC", "") : ""}</td>
                <td style={S.td}><TxLink hash={m.tx1} /></td>
                <td style={S.td}><TxLink hash={m.tx2} /></td>
              </tr>
            )}
          />
        </Section>

        {/* ── Betting P&L ─────────────────────────────────────────── */}
        <Section id="betting" label="BETTING PERFORMANCE" title="Betting P&L by Wallet" defaultOpen>
          <p style={{ color: "#666", fontSize: "0.8rem", fontFamily: "monospace", marginBottom: "1rem" }}>
            Net P&L = Winnings + Refunds - Wagered. Negative = lost to protocol fee (5%). Sorted by net P&L descending.
          </p>

          <div style={{ ...S.sectionLabel, marginTop: "1.5rem" }}>ETH MARKETS</div>
          <PaginatedTable
            data={data.ethBetting}
            headers={["WALLET", "MARKETS", "BETS", "WAGERED (ETH)", "WON (ETH)", "REFUNDED (ETH)", "NET P&L (ETH)"]}
            pageSize={100}
            searchField={(r) => r.w}
            renderRow={(r, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "#0e0e0e" : "#111" }}>
                <td style={S.td}><WalletLink addr={r.w} /></td>
                <td style={S.td}>{r.m}</td>
                <td style={S.td}>{r.b}</td>
                <td style={S.td}>{wei(r.wa)}</td>
                <td style={S.td}>{wei(r.wo)}</td>
                <td style={S.td}>{wei(r.r)}</td>
                <td style={{ ...S.td, fontWeight: 700, color: pnlColor(r.n) }}>{wei(r.n)}</td>
              </tr>
            )}
          />

          {data.burnBetting.length > 0 && <>
            <div style={{ ...S.sectionLabel, marginTop: "1.5rem" }}>RUSH BURN MARKETS</div>
            <PaginatedTable
              data={data.burnBetting}
              headers={["WALLET", "MARKETS", "BETS", "WAGERED (RUSH)", "WON (RUSH)", "REFUNDED (RUSH)", "NET P&L (RUSH)"]}
              pageSize={100}
              renderRow={(r, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "#0e0e0e" : "#111" }}>
                  <td style={S.td}><WalletLink addr={r.w} /></td>
                  <td style={S.td}>{r.m}</td>
                  <td style={S.td}>{r.b}</td>
                  <td style={S.td}>{wei(r.wa)}</td>
                  <td style={S.td}>{wei(r.wo)}</td>
                  <td style={S.td}>{wei(r.r)}</td>
                  <td style={{ ...S.td, fontWeight: 700, color: pnlColor(r.n) }}>{wei(r.n)}</td>
                </tr>
              )}
            />
          </>}
        </Section>

        {/* ── Tiles P&L ───────────────────────────────────────────── */}
        <Section id="tiles" label="TILES ECONOMY" title="Tiles P&L by Wallet" defaultOpen>
          <p style={{ color: "#666", fontSize: "0.8rem", fontFamily: "monospace", marginBottom: "1rem" }}>
            Complete financial breakdown per wallet. Deposits, buyout costs, fee distributions, and net position.
          </p>

          {[
            { label: "SERIES 1 (V1)", rows: data.tilesV1Pnl },
          ].map(({ label, rows }) => (
            <div key={label}>
              <div style={{ ...S.sectionLabel, marginTop: "1.5rem" }}>{label}</div>
              <PaginatedTable
                data={rows}
                headers={["WALLET", "DEPOSITS IN", "DEPOSITS OUT", "CLAIM FEES", "BUYOUT COST", "BUYOUT REV", "FEES CLAIMED", "APP TAX", "NET P&L"]}
                pageSize={100}
                searchField={(r) => r.w}
                renderRow={(r, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? "#0e0e0e" : "#111" }}>
                    <td style={S.td}><WalletLink addr={r.w} /></td>
                    <td style={S.td}>{wei(r.di)}</td>
                    <td style={S.td}>{wei(r.do)}</td>
                    <td style={S.td}>{wei(r.cf)}</td>
                    <td style={S.td}>{wei(r.bc)}</td>
                    <td style={S.td}>{wei(r.br)}</td>
                    <td style={{ ...S.td, color: "#00ff88" }}>{wei(r.fc)}</td>
                    <td style={S.td}>{wei(r.at)}</td>
                    <td style={{ ...S.td, fontWeight: 700, color: pnlColor(r.n) }}>{wei(r.n)}</td>
                  </tr>
                )}
              />
            </div>
          ))}
        </Section>

        {/* ── Housebot ─────────────────────────────────────────────── */}
        <Section id="housebot" label="HOUSEBOT TRANSPARENCY" title="Housebot (Liquidity Provider)" defaultOpen>
          <p style={{ color: "#666", fontSize: "0.8rem", fontFamily: "monospace", marginBottom: "1rem" }}>
            The housebot places bets to ensure two-sided markets. Without it, most markets would be one-sided and cancelled.
            It is funded by the protocol and operates at a loss — it exists solely to provide liquidity for real bettors.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {(() => { const hb = data.housebot; return [
              { v: weiShort(hb.ethWagered) + " ETH", l: "TOTAL WAGERED" },
              { v: weiShort(hb.ethWon) + " ETH", l: "WON BACK" },
              { v: weiShort(hb.ethRefunded) + " ETH", l: "REFUNDED" },
              { v: wei(hb.ethNet) + " ETH", l: "NET P&L", c: pnlColor(hb.ethNet) },
              { v: hb.ethMarkets.toLocaleString(), l: "ETH MARKETS" },
              { v: hb.ethBets.toLocaleString(), l: "ETH BETS" },
              { v: hb.burnMarkets.toLocaleString(), l: "RUSH MARKETS" },
              { v: hb.burnBets.toLocaleString(), l: "RUSH BETS" },
            ].map((stat: { v: string; l: string; c?: string }, i: number) => (
              <div key={i} style={S.card}>
                <div style={{ ...S.metricValue, fontSize: "1rem", color: stat.c || "#e0e0e0" }}>
                  {stat.v}
                </div>
                <div style={S.metricLabel}>{stat.l}</div>
              </div>
            )); })()}
          </div>
          <div style={{ ...S.card, borderColor: "#1a1a1a" }}>
            <div className="flex items-center gap-2 mb-2">
              <span style={{ fontSize: "0.7rem", fontFamily: "monospace", color: "#555", fontWeight: 700 }}>WALLET</span>
              <WalletLink addr={data.housebot.address} />
            </div>
            <p style={{ color: "#555", fontSize: "0.75rem", fontFamily: "monospace", lineHeight: 1.7 }}>
              The housebot accounts for {Number(m.totalEthVolumeWei) > 0 ? ((Number(data.housebot.ethWagered) / Number(m.totalEthVolumeWei)) * 100).toFixed(1) : "0"}% of
              total ETH volume. All bets are verifiable on Basescan. The net loss of {wei(data.housebot.ethNet)} ETH
              represents the cost of providing liquidity to the protocol.
            </p>
          </div>

          <div style={{ ...S.sectionLabel, marginTop: "1.5rem" }}>NET PROTOCOL REVENUE</div>
          <div style={{ ...S.card, borderColor: "#ffd70022" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontFamily: "monospace", fontSize: "0.85rem" }}>
              <div className="flex justify-between">
                <span style={{ color: "#999" }}>Protocol fees claimed (V1)</span>
                <span style={{ color: "#ffd700" }}>+{weiShort(m.devFeesClaimedWei)} ETH</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "#999" }}>Housebot cost (liquidity)</span>
                <span style={{ color: "#ff4444" }}>{wei(data.housebot.ethNet)} ETH</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "#999" }}>Manual volume seeding</span>
                <span style={{ color: "#ff4444" }}>~1.0000 ETH</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "#999" }}>DexScreener listing ($300)</span>
                <span style={{ color: "#ff4444" }}>~0.1700 ETH</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "#999" }}>Twitter/X Gold ($170/mo)</span>
                <span style={{ color: "#ff4444" }}>~0.1000 ETH</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "#999" }}>Vercel hosting ($200)</span>
                <span style={{ color: "#ff4444" }}>~0.1100 ETH</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "#999" }}>Hardware (3090Ti $1,500, 12TB NVMe $1,200, full build ~$4,000)</span>
                <span style={{ color: "#ff4444" }}>~2.3500 ETH</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: "#999" }}>Monthly services (Alchemy, Upstash, Ably, electricity)</span>
                <span style={{ color: "#ff4444" }}>ongoing</span>
              </div>
              <div style={{ borderTop: "1px solid #1a1a1a", paddingTop: "0.5rem", marginTop: "0.25rem" }} className="flex justify-between">
                <span style={{ color: "#e0e0e0", fontWeight: 700 }}>Net protocol P&L (excl. monthly)</span>
                {(() => {
                  // housebot loss + external costs (volume seeding, dex, twitter, vercel, hardware)
                  const housebotLoss = BigInt(data.housebot.ethNet.startsWith("-") ? data.housebot.ethNet.slice(1) : "0");
                  const externalCosts = BigInt("3730000000000000000"); // 1.0 + 0.17 + 0.1 + 0.11 + 2.35 = 3.73 ETH
                  const fees = BigInt(m.devFeesClaimedWei);
                  const net = fees - housebotLoss - externalCosts;
                  return <span style={{ color: pnlColor(net.toString()), fontWeight: 700 }}>
                    {weiShort(net.toString())} ETH
                  </span>;
                })()}
              </div>
            </div>
          </div>
        </Section>

        {/* ── Dev Fee Claims ──────────────────────────────────────── */}
        <Section id="devfees" label="PROTOCOL FEE CLAIMS (V1)" title={`Protocol Fee Claims (${data.devClaims.length})`}>
          <p style={{ color: "#666", fontSize: "0.8rem", fontFamily: "monospace", marginBottom: "1rem" }}>
            Every ETH claimed by the protocol wallet from Series 1 tiles. Harberger tax protocol share, buyout fees, and appreciation taxes. Total: {weiShort(m.devFeesClaimedWei)} ETH.
          </p>
          <PaginatedTable
            data={data.devClaims}
            headers={["TIMESTAMP", "AMOUNT (ETH)", "TX HASH"]}
            pageSize={50}
            renderRow={(r, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "#0e0e0e" : "#111" }}>
                <td style={{ ...S.td, color: "#777" }}>{r.t.replace(" UTC", "")}</td>
                <td style={{ ...S.td, color: "#ffd700" }}>{wei(r.a)}</td>
                <td style={S.td}><TxLink hash={r.tx} /></td>
              </tr>
            )}
          />
        </Section>

        {/* ── Distributions ───────────────────────────────────────── */}
        <Section id="distributions" label="HOLDER DISTRIBUTIONS" title={`Fee Distributions (${data.distributions.length})`}>
          <p style={{ color: "#666", fontSize: "0.8rem", fontFamily: "monospace", marginBottom: "1rem" }}>
            Every distribution of fees to tile holders. Total: {weiShort(m.totalDistributedWei)} ETH.
          </p>
          <PaginatedTable
            data={data.distributions}
            headers={["TIMESTAMP", "CONTRACT", "AMOUNT (ETH)", "TX HASH"]}
            pageSize={50}
            renderRow={(r, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "#0e0e0e" : "#111" }}>
                <td style={{ ...S.td, color: "#777" }}>{r.t.replace(" UTC", "")}</td>
                <td style={S.td}>{r.c}</td>
                <td style={{ ...S.td, color: "#00ff88" }}>{wei(r.a)}</td>
                <td style={S.td}><TxLink hash={r.tx} /></td>
              </tr>
            )}
          />
        </Section>

        {/* ── Foreclosures ────────────────────────────────────────── */}
        <Section id="foreclosures" label="FORECLOSURES" title={`Tile Foreclosures (${data.foreclosures.length})`} defaultOpen>
          <p style={{ color: "#666", fontSize: "0.8rem", fontFamily: "monospace", marginBottom: "1rem" }}>
            Tiles foreclosed when deposit reached zero from Harberger tax. Former owners received no payout — their deposit was fully consumed by tax payments over time.
          </p>
          <div style={S.tableWrap}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["TIMESTAMP", "CONTRACT", "TILE", "FORMER OWNER", "TX HASH"].map((h) => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.foreclosures.map((f, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? "#0e0e0e" : "#111" }}>
                    <td style={{ ...S.td, color: "#777" }}>{f.t.replace(" UTC", "")}</td>
                    <td style={S.td}>{f.c}</td>
                    <td style={S.td}>#{f.ti}</td>
                    <td style={S.td}><WalletLink addr={f.o} /></td>
                    <td style={S.td}><TxLink hash={f.tx} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ── Methodology ─────────────────────────────────────────── */}
        <section style={{ ...S.section, marginTop: "2rem" }}>
          <div style={S.sectionLabel}>METHODOLOGY</div>
          <div style={{ ...S.card, borderColor: "#1a1a1a" }}>
            <p style={{ color: "#777", fontSize: "0.8rem", lineHeight: 1.8, fontFamily: "monospace" }}>
              This report was generated by scanning all event logs from Rush Protocol smart contracts on Base mainnet
              using <code style={{ color: "#00aaff" }}>eth_getLogs</code> RPC calls. No off-chain databases, no manual entries.
              Every value is derived from on-chain events emitted by verified contracts.
            </p>
            <p style={{ color: "#777", fontSize: "0.8rem", lineHeight: 1.8, fontFamily: "monospace", marginTop: "0.75rem" }}>
              P&amp;L calculations use a deposit state machine that replays events chronologically to track
              each wallet&apos;s inflows and outflows. Betting P&amp;L = Winnings + Refunds - Wagered.
              Tiles P&amp;L = Deposits Out + Buyout Revenue + Fees Claimed - Deposits In - Claim Fees - Tier Price - Buyout Cost - Appreciation Tax.
            </p>
            <p style={{ color: "#555", fontSize: "0.75rem", lineHeight: 1.8, fontFamily: "monospace", marginTop: "0.75rem" }}>
              Verify any transaction by clicking its hash to open on Basescan. All contracts are open source and verified.
            </p>
          </div>
        </section>

        {/* ── CTA ─────────────────────────────────────────────────── */}
        <div className="flex gap-4 justify-center flex-wrap mb-16">
          <a href={`${BASESCAN}/address/${m.contracts.factory_burn}`} target="_blank" rel="noopener noreferrer"
             className="inline-flex items-center gap-2 px-6 py-3 rounded font-bold text-sm"
             style={{ background: "rgba(0,170,255,0.1)", border: "1px solid rgba(0,170,255,0.3)",
                      color: "#00aaff", fontFamily: "monospace", textDecoration: "none" }}>
            VIEW ON BASESCAN <ExternalLink size={12} />
          </a>
          <Link href="/docs"
                className="inline-flex items-center gap-2 px-6 py-3 rounded font-bold text-sm"
                style={{ background: "rgba(0,255,136,0.1)", border: "1px solid rgba(0,255,136,0.3)",
                         color: "#00ff88", fontFamily: "monospace", textDecoration: "none" }}>
            DOCUMENTATION
          </Link>
          <Link href="/stats"
                className="inline-flex items-center gap-2 px-6 py-3 rounded font-bold text-sm"
                style={{ background: "rgba(255,215,0,0.1)", border: "1px solid rgba(255,215,0,0.3)",
                         color: "#ffd700", fontFamily: "monospace", textDecoration: "none" }}>
            LIVE STATS
          </Link>
        </div>

      </main>
    </div>
  );
}
