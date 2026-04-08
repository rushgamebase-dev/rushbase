"use client";

import Header from "@/components/Header";
import {
  FACTORY_ADDRESS,
  RUSH_TILES_ADDRESS,
  RUSH_TILES_V2_ADDRESS,
  RUSH_TOKEN_ADDRESS,
} from "@/lib/contracts";

const OLD_ETH_FACTORY = "0x5b04F3DFaE780A7e109066E754d27f491Af55Af9";

const S = {
  page: { background: "#0a0a0a", color: "#ccc", minHeight: "100vh", fontFamily: "monospace" } as const,
  container: { maxWidth: 900, margin: "0 auto", padding: "2rem 1.5rem" } as const,
  h1: { color: "#ffd700", fontSize: "2.2rem", fontWeight: 900, marginBottom: "0.25rem", letterSpacing: "-0.5px" } as const,
  subtitle: { color: "#666", fontSize: "0.95rem", marginBottom: "2rem", lineHeight: 1.6 } as const,
  h2: { color: "#e0e0e0", fontSize: "1.4rem", fontWeight: 800, marginTop: "3rem", marginBottom: "1rem", borderBottom: "1px solid #1a1a1a", paddingBottom: "0.5rem" } as const,
  h3: { color: "#aaa", fontSize: "1.05rem", fontWeight: 700, marginTop: "1.75rem", marginBottom: "0.5rem" } as const,
  p: { lineHeight: 1.75, marginBottom: "1rem", color: "#999", fontSize: "0.9rem" } as const,
  addr: { background: "#111", padding: "2px 8px", borderRadius: 4, color: "#ffd700", fontSize: "0.78rem", wordBreak: "break-all" as const } as const,
  table: { width: "100%", borderCollapse: "collapse" as const, marginBottom: "1.5rem", fontSize: "0.85rem" } as const,
  th: { textAlign: "left" as const, padding: "0.6rem 0.75rem", borderBottom: "1px solid #222", color: "#666", fontWeight: 600, textTransform: "uppercase" as const, fontSize: "0.75rem", letterSpacing: "0.5px" } as const,
  td: { padding: "0.6rem 0.75rem", borderBottom: "1px solid #111", color: "#aaa" } as const,
  code: { background: "#111", padding: "1rem", borderRadius: 6, display: "block", marginBottom: "1rem", fontSize: "0.8rem", color: "#777", overflowX: "auto" as const, border: "1px solid #1a1a1a" } as const,
  link: { color: "#ffd700", textDecoration: "none" } as const,
  badge: { display: "inline-block", padding: "4px 12px", borderRadius: 4, fontSize: "0.75rem", fontWeight: 700 } as const,
  tagLegacy: { display: "inline-block", padding: "1px 7px", borderRadius: 3, fontSize: "0.65rem", fontWeight: 700, background: "#2a1a00", color: "#ffaa00", border: "1px solid #ffaa0033", marginLeft: "0.5rem", verticalAlign: "middle" } as const,
  tagCurrent: { display: "inline-block", padding: "1px 7px", borderRadius: 3, fontSize: "0.65rem", fontWeight: 700, background: "#0a2a0a", color: "#00ff88", border: "1px solid #00ff8833", marginLeft: "0.5rem", verticalAlign: "middle" } as const,
  highlight: { background: "#111", border: "1px solid #ffd70022", borderRadius: 8, padding: "1.25rem 1.5rem", marginBottom: "1.5rem" } as const,
  founderCard: { background: "linear-gradient(135deg, #1a1400 0%, #0a0a0a 100%)", border: "1px solid #ffd70033", borderRadius: 10, padding: "1.5rem", marginBottom: "1.5rem" } as const,
  normalCard: { background: "#0d0d0d", border: "1px solid #222", borderRadius: 10, padding: "1.5rem", marginBottom: "1.5rem" } as const,
  stat: { display: "inline-block", textAlign: "center" as const, padding: "0.75rem 1.25rem" } as const,
  statVal: { fontSize: "1.5rem", fontWeight: 900, display: "block" } as const,
  statLabel: { fontSize: "0.7rem", color: "#555", textTransform: "uppercase" as const, letterSpacing: "0.5px" } as const,
};

export default function DocsPage() {
  return (
    <div style={S.page}>
      <Header />
      <div style={S.container}>

        {/* ─── Hero ─── */}
        <h1 style={S.h1}>Rush Protocol</h1>
        <p style={S.subtitle}>
          Fully on-chain prediction market on <strong style={{ color: "#e0e0e0" }}>Base</strong>.
          AI observes live traffic cameras. Users bet on real outcomes.
          30% of every $RUSH pool is burned forever.
        </p>

        {/* ─── Key Numbers ─── */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "2rem", background: "#0d0d0d", borderRadius: 8, border: "1px solid #1a1a1a", padding: "0.5rem 0" }}>
          <div style={S.stat}>
            <span style={{ ...S.statVal, color: "#ffd700" }}>0%</span>
            <span style={S.statLabel}>House Edge</span>
          </div>
          <div style={S.stat}>
            <span style={{ ...S.statVal, color: "#ff6666" }}>30%</span>
            <span style={S.statLabel}>Burned / Round</span>
          </div>
          <div style={S.stat}>
            <span style={{ ...S.statVal, color: "#00ff88" }}>200</span>
            <span style={S.statLabel}>Total Tiles</span>
          </div>
          <div style={S.stat}>
            <span style={{ ...S.statVal, color: "#88aaff" }}>5 min</span>
            <span style={S.statLabel}>Round Duration</span>
          </div>
        </div>

        {/* ─── Contracts ─── */}
        <h2 style={S.h2}>Contracts & Token</h2>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Contract</th>
              <th style={S.th}>Address</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={S.td}><strong style={{ color: "#ffd700" }}>$RUSH Token</strong></td>
              <td style={S.td}>
                <a href={`https://basescan.org/token/${RUSH_TOKEN_ADDRESS}`} target="_blank" rel="noopener noreferrer" style={S.link}>
                  <code style={S.addr}>{RUSH_TOKEN_ADDRESS}</code>
                </a>
              </td>
            </tr>
            <tr>
              <td style={S.td}>BurnMarketFactory<span style={S.tagCurrent}>production</span></td>
              <td style={S.td}>
                <a href={`https://basescan.org/address/${FACTORY_ADDRESS}`} target="_blank" rel="noopener noreferrer" style={S.link}>
                  <code style={S.addr}>{FACTORY_ADDRESS}</code>
                </a>
              </td>
            </tr>
            <tr>
              <td style={S.td}>RushTiles Series 1</td>
              <td style={S.td}>
                <a href={`https://basescan.org/address/${RUSH_TILES_ADDRESS}`} target="_blank" rel="noopener noreferrer" style={S.link}>
                  <code style={S.addr}>{RUSH_TILES_ADDRESS}</code>
                </a>
              </td>
            </tr>
            <tr>
              <td style={S.td}>RushTiles Series 2</td>
              <td style={S.td}>
                <a href={`https://basescan.org/address/${RUSH_TILES_V2_ADDRESS}`} target="_blank" rel="noopener noreferrer" style={S.link}>
                  <code style={S.addr}>{RUSH_TILES_V2_ADDRESS}</code>
                </a>
              </td>
            </tr>
            <tr>
              <td style={S.td}><span style={{ color: "#555" }}>MarketFactory</span><span style={S.tagLegacy}>legacy</span></td>
              <td style={S.td}>
                <a href={`https://basescan.org/address/${OLD_ETH_FACTORY}`} target="_blank" rel="noopener noreferrer" style={{ ...S.link, opacity: 0.5 }}>
                  <code style={{ ...S.addr, color: "#666" }}>{OLD_ETH_FACTORY}</code>
                </a>
              </td>
            </tr>
          </tbody>
        </table>

        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "2rem", flexWrap: "wrap" }}>
          <a href={`https://flaunch.gg/base/coins/${RUSH_TOKEN_ADDRESS}`} target="_blank" rel="noopener noreferrer"
            style={{ ...S.badge, background: "#1a2a1a", color: "#00ff88", border: "1px solid #00ff8833" }}>
            Buy $RUSH on Flaunch
          </a>
          <a href={`https://dexscreener.com/base/${RUSH_TOKEN_ADDRESS}`} target="_blank" rel="noopener noreferrer"
            style={{ ...S.badge, background: "#1a1a2a", color: "#88aaff", border: "1px solid #88aaff33" }}>
            DexScreener
          </a>
        </div>

        {/* ─── How It Works ─── */}
        <h2 style={S.h2}>How It Works</h2>
        <div style={S.highlight}>
          <p style={{ ...S.p, marginBottom: "0.5rem", color: "#bbb" }}>
            <strong style={{ color: "#e0e0e0" }}>1. Watch</strong> &mdash; Live traffic camera streams 24/7
          </p>
          <p style={{ ...S.p, marginBottom: "0.5rem", color: "#bbb" }}>
            <strong style={{ color: "#e0e0e0" }}>2. Predict</strong> &mdash; Bet $RUSH on Over or Under the vehicle threshold
          </p>
          <p style={{ ...S.p, marginBottom: "0.5rem", color: "#bbb" }}>
            <strong style={{ color: "#e0e0e0" }}>3. AI Counts</strong> &mdash; YOLOv8 detects and counts every vehicle crossing
          </p>
          <p style={{ ...S.p, marginBottom: 0, color: "#bbb" }}>
            <strong style={{ color: "#e0e0e0" }}>4. Win or Burn</strong> &mdash; 70% to winners, 30% burned forever
          </p>
        </div>

        <h3 style={S.h3}>$RUSH Markets <span style={S.tagCurrent}>current</span></h3>
        <p style={S.p}>
          Bet with $RUSH tokens. Winners receive 70% of the pool. 30% is permanently burned.
          Zero protocol fees. Every resolved market makes $RUSH more scarce.
        </p>
        <pre style={S.code}>{`Bets ($RUSH) -> Pool -> Resolve
                         ├── 70% -> Winners (proportional to bet)
                         └── 30% -> Burned (0x...dEaD, permanent)`}</pre>

        <h3 style={S.h3}>ETH Markets <span style={S.tagLegacy}>legacy</span></h3>
        <p style={S.p}>
          Original format. Bet with ETH, winners split 95%. The 5% fee goes to Series 1 tile holders.
        </p>

        {/* ─── $RUSH Burn ─── */}
        <h2 style={S.h2}>$RUSH &mdash; Deflationary Token</h2>
        <p style={S.p}>
          $RUSH is an ERC-20 on Base launched via Flaunch. It&apos;s the sole betting currency.
          The burn is hardcoded in the smart contract &mdash; nobody can change or disable it.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginBottom: "1.5rem" }}>
          <div style={{ flex: 1, minWidth: 180, background: "#0a150a", border: "1px solid #00ff8822", borderRadius: 8, padding: "1rem", textAlign: "center" as const }}>
            <span style={{ fontSize: "1.8rem", fontWeight: 900, color: "#00ff88", display: "block" }}>70%</span>
            <span style={{ fontSize: "0.75rem", color: "#666" }}>TO WINNERS</span>
          </div>
          <div style={{ flex: 1, minWidth: 180, background: "#1a0a0a", border: "1px solid #ff444422", borderRadius: 8, padding: "1rem", textAlign: "center" as const }}>
            <span style={{ fontSize: "1.8rem", fontWeight: 900, color: "#ff6666", display: "block" }}>30%</span>
            <span style={{ fontSize: "0.75rem", color: "#666" }}>BURNED FOREVER</span>
          </div>
          <div style={{ flex: 1, minWidth: 180, background: "#0d0d0d", border: "1px solid #222", borderRadius: 8, padding: "1rem", textAlign: "center" as const }}>
            <span style={{ fontSize: "1.8rem", fontWeight: 900, color: "#ffd700", display: "block" }}>0%</span>
            <span style={{ fontSize: "0.75rem", color: "#666" }}>PROTOCOL FEES</span>
          </div>
        </div>

        {/* ─── Founder Tiles ─── */}
        <h2 style={S.h2}>Founder Tiles <span style={{ color: "#ffd700", fontSize: "0.8rem" }}>Series 2</span></h2>
        <div style={S.founderCard}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
            <span style={{ fontSize: "1.6rem", fontWeight: 900, color: "#ffd700" }}>Founder Tier</span>
            <span style={{ ...S.tagCurrent, marginLeft: 0 }}>limited</span>
          </div>
          <p style={{ ...S.p, color: "#bbb", marginBottom: "1.25rem" }}>
            Premium ownership tier with 5x revenue weight and permanent buyout protection.
            Founders cannot be forced out &mdash; your position is yours as long as you maintain the tax deposit.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem" }}>
            <div>
              <span style={{ display: "block", fontSize: "1.3rem", fontWeight: 900, color: "#ffd700" }}>5 shares</span>
              <span style={{ fontSize: "0.7rem", color: "#666" }}>PER TILE (5x Normal)</span>
            </div>
            <div>
              <span style={{ display: "block", fontSize: "1.3rem", fontWeight: 900, color: "#ffd700" }}>0.5 ETH</span>
              <span style={{ fontSize: "0.7rem", color: "#666" }}>MINIMUM PRICE</span>
            </div>
            <div>
              <span style={{ display: "block", fontSize: "1.3rem", fontWeight: 900, color: "#ff6666" }}>Immune</span>
              <span style={{ fontSize: "0.7rem", color: "#666" }}>BUYOUT PROTECTED</span>
            </div>
          </div>
        </div>

        <div style={S.normalCard}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
            <span style={{ fontSize: "1.2rem", fontWeight: 800, color: "#aaa" }}>Normal Tier</span>
          </div>
          <p style={{ ...S.p, marginBottom: "1rem" }}>
            Standard tile with 1 share of revenue. Can be bought out at your declared price.
            Lower entry cost, same Harberger mechanics.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem" }}>
            <div>
              <span style={{ display: "block", fontSize: "1.1rem", fontWeight: 800, color: "#aaa" }}>1 share</span>
              <span style={{ fontSize: "0.7rem", color: "#555" }}>PER TILE</span>
            </div>
            <div>
              <span style={{ display: "block", fontSize: "1.1rem", fontWeight: 800, color: "#aaa" }}>0.1 ETH</span>
              <span style={{ fontSize: "0.7rem", color: "#555" }}>MINIMUM PRICE</span>
            </div>
            <div>
              <span style={{ display: "block", fontSize: "1.1rem", fontWeight: 800, color: "#aaa" }}>Open</span>
              <span style={{ fontSize: "0.7rem", color: "#555" }}>CAN BE BOUGHT OUT</span>
            </div>
          </div>
        </div>

        {/* ─── Series 1 ─── */}
        <h2 style={S.h2}>Series 1 Tiles <span style={S.tagLegacy}>V1</span></h2>
        <p style={S.p}>
          The original 100 tiles. Each tile = 1 equal share of ETH market fees and Flaunch trading fees.
          Harberger tax model: declare a price, pay 5%/week tax, anyone can force-buy at your price.
        </p>
        <table style={S.table}>
          <thead><tr><th style={S.th}>Parameter</th><th style={S.th}>Value</th></tr></thead>
          <tbody>
            <tr><td style={S.td}>Tiles</td><td style={S.td}>100 (10x10 grid)</td></tr>
            <tr><td style={S.td}>Max per wallet</td><td style={S.td}>5</td></tr>
            <tr><td style={S.td}>Shares per tile</td><td style={S.td}>1</td></tr>
            <tr><td style={S.td}>Min price</td><td style={S.td}>0.01 ETH</td></tr>
            <tr><td style={S.td}>Weekly tax</td><td style={S.td}>5% of declared price</td></tr>
            <tr><td style={S.td}>Buyout fee</td><td style={S.td}>10%</td></tr>
            <tr><td style={S.td}>Price increase tax</td><td style={S.td}>30% of appreciation</td></tr>
            <tr><td style={S.td}>Price decay</td><td style={S.td}>20% per 2 weeks (floor 10%)</td></tr>
          </tbody>
        </table>

        {/* ─── Fee Splits ─── */}
        <h2 style={S.h2}>Revenue Distribution</h2>

        <h3 style={S.h3}>Series 2</h3>
        <table style={S.table}>
          <thead>
            <tr><th style={S.th}>Source</th><th style={S.th}>Rate</th><th style={S.th}>Holders</th><th style={S.th}>Dev</th></tr>
          </thead>
          <tbody>
            <tr>
              <td style={S.td}>External ETH</td>
              <td style={S.td}>Auto</td>
              <td style={{ ...S.td, color: "#00ff88" }}>100%</td>
              <td style={S.td}>0%</td>
            </tr>
            <tr>
              <td style={S.td}>Harberger tax</td>
              <td style={S.td}>5%/week</td>
              <td style={S.td}>30%</td>
              <td style={S.td}>70%</td>
            </tr>
            <tr>
              <td style={S.td}>Buyout + appreciation + claim fees</td>
              <td style={S.td}>10% / 30% / 10%</td>
              <td style={S.td}>0%</td>
              <td style={{ ...S.td, color: "#ffd700" }}>100%</td>
            </tr>
          </tbody>
        </table>
        <p style={{ ...S.p, fontSize: "0.8rem", color: "#555" }}>
          Founder tiles earn 5x the per-share revenue of Normal tiles.
        </p>

        <h3 style={S.h3}>Series 1</h3>
        <table style={S.table}>
          <thead>
            <tr><th style={S.th}>Source</th><th style={S.th}>Rate</th><th style={S.th}>Holders</th><th style={S.th}>Dev</th></tr>
          </thead>
          <tbody>
            <tr>
              <td style={S.td}>ETH market fees</td>
              <td style={S.td}>5% of pool</td>
              <td style={{ ...S.td, color: "#00ff88" }}>100%</td>
              <td style={S.td}>0%</td>
            </tr>
            <tr>
              <td style={S.td}>Flaunch trading fees</td>
              <td style={S.td}>Auto</td>
              <td style={{ ...S.td, color: "#00ff88" }}>100%</td>
              <td style={S.td}>0%</td>
            </tr>
            <tr>
              <td style={S.td}>Harberger tax</td>
              <td style={S.td}>5%/week</td>
              <td style={S.td}>50%</td>
              <td style={S.td}>50%</td>
            </tr>
            <tr>
              <td style={S.td}>Buyout + appreciation + claim fees</td>
              <td style={S.td}>10% / 30% / 10%</td>
              <td style={S.td}>40%</td>
              <td style={S.td}>60%</td>
            </tr>
          </tbody>
        </table>

        {/* ─── Security ─── */}
        <h2 style={S.h2}>Security & Trust</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
          {[
            { label: "Open Source", desc: "All contracts verified and readable on Basescan" },
            { label: "No House Edge", desc: "Pari-mutuel pools \u2014 protocol never bets against you" },
            { label: "Immutable Rules", desc: "Fee rates and burn % are hardcoded \u2014 nobody can change them" },
            { label: "Permanent Burn", desc: "30% goes to 0x...dEaD \u2014 irrecoverable by anyone, ever" },
            { label: "Industry Standards", desc: "Built on OpenZeppelin \u2014 the most battle-tested Solidity library" },
            { label: "Proof of Outcome", desc: "Every round has timestamped evidence with SHA-256 hashes" },
          ].map(({ label, desc }) => (
            <div key={label} style={{ background: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: 6, padding: "0.75rem 1rem" }}>
              <strong style={{ color: "#e0e0e0", fontSize: "0.85rem", display: "block", marginBottom: "0.25rem" }}>{label}</strong>
              <span style={{ color: "#666", fontSize: "0.78rem", lineHeight: 1.4 }}>{desc}</span>
            </div>
          ))}
        </div>

        {/* ─── Links ─── */}
        <h2 style={S.h2}>Links</h2>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <a href="https://rushgame.vip"
            style={{ ...S.badge, background: "#1a1a1a", color: "#ffd700", border: "1px solid #ffd70033" }}>
            rushgame.vip
          </a>
          <a href={`https://basescan.org/token/${RUSH_TOKEN_ADDRESS}`} target="_blank" rel="noopener noreferrer"
            style={{ ...S.badge, background: "#1a1a1a", color: "#aaa", border: "1px solid #333" }}>
            Basescan
          </a>
          <a href={`https://flaunch.gg/base/coins/${RUSH_TOKEN_ADDRESS}`} target="_blank" rel="noopener noreferrer"
            style={{ ...S.badge, background: "#1a2a1a", color: "#00ff88", border: "1px solid #00ff8833" }}>
            Flaunch
          </a>
          <a href={`https://dexscreener.com/base/${RUSH_TOKEN_ADDRESS}`} target="_blank" rel="noopener noreferrer"
            style={{ ...S.badge, background: "#1a1a2a", color: "#88aaff", border: "1px solid #88aaff33" }}>
            DexScreener
          </a>
          <a href="https://x.com/rushgamebase" target="_blank" rel="noopener noreferrer"
            style={{ ...S.badge, background: "#1a1a1a", color: "#aaa", border: "1px solid #333" }}>
            Twitter
          </a>
        </div>

        <div style={{ marginTop: "3rem", paddingTop: "1rem", borderTop: "1px solid #1a1a1a", color: "#333", fontSize: "0.75rem" }}>
          Rush Protocol &mdash; On-Chain Prediction Market on Base
        </div>
      </div>
    </div>
  );
}
