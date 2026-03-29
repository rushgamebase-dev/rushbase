"use client";

import Header from "@/components/Header";

const RUSH_TOKEN = "0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b";
const TILES_CONTRACT = "0x6cE3873e31Ab5440fA6AF1860F8E36110504c9C4";
const FACTORY_CONTRACT = "0x5b04F3DFaE780A7e109066E754d27f491Af55Af9";

const S = {
  page: { background: "#0a0a0a", color: "#ccc", minHeight: "100vh", fontFamily: "monospace" } as const,
  container: { maxWidth: 860, margin: "0 auto", padding: "2rem 1.5rem" } as const,
  h1: { color: "#ffd700", fontSize: "2rem", fontWeight: 900, marginBottom: "0.5rem" } as const,
  h2: { color: "#e0e0e0", fontSize: "1.4rem", fontWeight: 800, marginTop: "2.5rem", marginBottom: "0.75rem", borderBottom: "1px solid #1a1a1a", paddingBottom: "0.5rem" } as const,
  h3: { color: "#aaa", fontSize: "1.1rem", fontWeight: 700, marginTop: "1.5rem", marginBottom: "0.5rem" } as const,
  p: { lineHeight: 1.7, marginBottom: "1rem", color: "#999", fontSize: "0.9rem" } as const,
  addr: { background: "#111", padding: "2px 8px", borderRadius: 4, color: "#ffd700", fontSize: "0.8rem", wordBreak: "break-all" as const } as const,
  table: { width: "100%", borderCollapse: "collapse" as const, marginBottom: "1.5rem", fontSize: "0.85rem" } as const,
  th: { textAlign: "left" as const, padding: "0.5rem 0.75rem", borderBottom: "1px solid #222", color: "#888", fontWeight: 600 } as const,
  td: { padding: "0.5rem 0.75rem", borderBottom: "1px solid #111", color: "#aaa" } as const,
  code: { background: "#111", padding: "1rem", borderRadius: 6, display: "block", marginBottom: "1rem", fontSize: "0.8rem", color: "#888", overflowX: "auto" as const, border: "1px solid #1a1a1a" } as const,
  link: { color: "#ffd700", textDecoration: "none" } as const,
  badge: { display: "inline-block", padding: "2px 10px", borderRadius: 4, fontSize: "0.75rem", fontWeight: 700 } as const,
};

export default function DocsPage() {
  return (
    <div style={S.page}>
      <Header />
      <div style={S.container}>
        <h1 style={S.h1}>Rush Documentation</h1>
        <p style={S.p}>
          Rush is a fully on-chain, AI-powered prediction market on{" "}
          <strong style={{ color: "#e0e0e0" }}>Base Mainnet</strong>. Users bet on real-world outcomes observed by computer vision.
          100 Harberger-tax tiles (Socios) earn proportional shares of all protocol fees.
        </p>

        {/* Token & Contracts */}
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
              <td style={S.td}><strong style={{color:"#ffd700"}}>$RUSH Token</strong></td>
              <td style={S.td}>
                <a href={`https://basescan.org/token/${RUSH_TOKEN}`} target="_blank" rel="noopener noreferrer" style={S.link}>
                  <code style={S.addr}>{RUSH_TOKEN}</code>
                </a>
              </td>
            </tr>
            <tr>
              <td style={S.td}>RushTiles (Socios)</td>
              <td style={S.td}>
                <a href={`https://basescan.org/address/${TILES_CONTRACT}`} target="_blank" rel="noopener noreferrer" style={S.link}>
                  <code style={S.addr}>{TILES_CONTRACT}</code>
                </a>
              </td>
            </tr>
            <tr>
              <td style={S.td}>MarketFactory</td>
              <td style={S.td}>
                <a href={`https://basescan.org/address/${FACTORY_CONTRACT}`} target="_blank" rel="noopener noreferrer" style={S.link}>
                  <code style={S.addr}>{FACTORY_CONTRACT}</code>
                </a>
              </td>
            </tr>
          </tbody>
        </table>

        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
          <a
            href={`https://app.uniswap.org/swap?outputCurrency=${RUSH_TOKEN}&chain=base`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...S.badge, background: "#1a2a1a", color: "#00ff88", border: "1px solid #00ff8833" }}
          >
            Buy $RUSH on Uniswap
          </a>
          <a
            href={`https://dexscreener.com/base/${RUSH_TOKEN}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...S.badge, background: "#1a1a2a", color: "#88aaff", border: "1px solid #88aaff33" }}
          >
            DexScreener
          </a>
        </div>

        {/* How it works */}
        <h2 style={S.h2}>How Markets Work</h2>
        <p style={S.p}>
          Each round, an AI model (YOLOv8) counts vehicles on a live traffic camera. Users bet on whether the count will be Under or Over a threshold.
          Winners split the entire pool minus a 5% protocol fee. No house edge &mdash; pari-mutuel model.
        </p>
        <pre style={S.code}>{`OPEN (bets accepted) -> LOCKED (counting) -> RESOLVED (winners paid)
                                                  |
                                           5% fee -> Treasury -> Tile Holders`}</pre>

        {/* Tiles / Socios */}
        <h2 style={S.h2}>Tiles (Socios) &mdash; Revenue Sharing</h2>
        <p style={S.p}>
          100 tiles on a 10x10 grid. Each tile = 1 share of protocol revenue. Harberger tax model:
          you declare a price, pay tax on it, and anyone can buy you out at that price.
        </p>

        <h3 style={S.h3}>Tile Parameters</h3>
        <table style={S.table}>
          <thead><tr><th style={S.th}>Parameter</th><th style={S.th}>Value</th></tr></thead>
          <tbody>
            <tr><td style={S.td}>Grid Size</td><td style={S.td}>100 tiles (fixed)</td></tr>
            <tr><td style={S.td}>Max Per Wallet</td><td style={S.td}>5 tiles</td></tr>
            <tr><td style={S.td}>Min Price</td><td style={S.td}>0.01 ETH</td></tr>
            <tr><td style={S.td}>Tax Rate</td><td style={S.td}>5% per week</td></tr>
            <tr><td style={S.td}>Buyout Fee</td><td style={S.td}>10% of effective price</td></tr>
            <tr><td style={S.td}>Appreciation Tax</td><td style={S.td}>30% of price increase</td></tr>
            <tr><td style={S.td}>Claim Fee (2nd+ tile)</td><td style={S.td}>10% of declared price</td></tr>
            <tr><td style={S.td}>Price Decay</td><td style={S.td}>20% per 2-week period (floor 10%)</td></tr>
            <tr><td style={S.td}>Max Price Increase</td><td style={S.td}>3x per transaction</td></tr>
          </tbody>
        </table>

        <h3 style={S.h3}>Tile Actions</h3>
        <table style={S.table}>
          <thead><tr><th style={S.th}>Action</th><th style={S.th}>Who</th><th style={S.th}>Description</th></tr></thead>
          <tbody>
            <tr><td style={S.td}>Claim</td><td style={S.td}>Anyone</td><td style={S.td}>Claim an empty tile. 1st tile free, 2nd+ pays 10% fee.</td></tr>
            <tr><td style={S.td}>Buyout</td><td style={S.td}>Anyone</td><td style={S.td}>Force-buy a tile at its effective price + fees.</td></tr>
            <tr><td style={S.td}>Set Price</td><td style={S.td}>Owner</td><td style={S.td}>Change your tile price. Raising costs 30% appreciation tax.</td></tr>
            <tr><td style={S.td}>Add Deposit</td><td style={S.td}>Owner</td><td style={S.td}>Top up your tax deposit to avoid foreclosure.</td></tr>
            <tr><td style={S.td}>Withdraw Deposit</td><td style={S.td}>Owner</td><td style={S.td}>Pull out excess deposit.</td></tr>
            <tr><td style={S.td}>Abandon</td><td style={S.td}>Owner</td><td style={S.td}>Give up tile, recover remaining deposit.</td></tr>
            <tr><td style={S.td}>Claim Fees</td><td style={S.td}>Owner</td><td style={S.td}>Withdraw accumulated commissions.</td></tr>
          </tbody>
        </table>

        {/* Fee Distribution */}
        <h2 style={S.h2}>Fee Distribution</h2>
        <table style={S.table}>
          <thead><tr><th style={S.th}>Source</th><th style={S.th}>Rate</th><th style={S.th}>Tile Holders</th><th style={S.th}>Dev</th></tr></thead>
          <tbody>
            <tr><td style={S.td}>Market betting</td><td style={S.td}>5% of pool</td><td style={{...S.td, color:"#00ff88"}}>100%</td><td style={S.td}>0%</td></tr>
            <tr><td style={S.td}>Flaunch trading fees</td><td style={S.td}>Auto</td><td style={{...S.td, color:"#00ff88"}}>100%</td><td style={S.td}>0%</td></tr>
            <tr><td style={S.td}>Harberger tax</td><td style={S.td}>5%/week</td><td style={S.td}>50%</td><td style={S.td}>50%</td></tr>
            <tr><td style={S.td}>Buyout + appreciation</td><td style={S.td}>10% + 30%</td><td style={S.td}>40%</td><td style={S.td}>60%</td></tr>
            <tr><td style={S.td}>Claim fee (2nd+)</td><td style={S.td}>10% of price</td><td style={S.td}>40%</td><td style={S.td}>60%</td></tr>
          </tbody>
        </table>

        <pre style={S.code}>{`Fees arrive -> Treasury -> distributeFees() -> globalRewardPerShare increases
                                                        |
                           Each tile = 1 share -> claimFees() -> ETH to your wallet

Direct ETH (Flaunch fees) -> receive() -> distributed immediately to holders`}</pre>

        {/* Commission example */}
        <h3 style={S.h3}>Commission Example</h3>
        <p style={S.p}>
          You own 2 tiles. 80 tiles are active. A market resolves with 10 ETH pool.
        </p>
        <pre style={S.code}>{`Protocol fee: 10 ETH * 5% = 0.5 ETH -> treasury
Per tile: 0.5 / 80 = 0.00625 ETH
Your commission: 0.00625 * 2 = 0.0125 ETH`}</pre>

        {/* Security */}
        <h2 style={S.h2}>Security</h2>
        <p style={S.p}>
          All contracts verified on Basescan. ReentrancyGuard (OpenZeppelin) on all payable functions.
          Checks-effects-interactions pattern. Slither audited. 155 unit tests passing.
          Emergency withdraw requires 90 days of inactivity.
        </p>

        {/* Links */}
        <h2 style={S.h2}>Links</h2>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <a href="https://rushgame.vip" style={{ ...S.badge, background: "#1a1a1a", color: "#ffd700", border: "1px solid #ffd70033" }}>
            rushgame.vip
          </a>
          <a href={`https://basescan.org/token/${RUSH_TOKEN}`} target="_blank" rel="noopener noreferrer" style={{ ...S.badge, background: "#1a1a1a", color: "#aaa", border: "1px solid #333" }}>
            Basescan
          </a>
          <a href={`https://app.uniswap.org/swap?outputCurrency=${RUSH_TOKEN}&chain=base`} target="_blank" rel="noopener noreferrer" style={{ ...S.badge, background: "#1a2a1a", color: "#00ff88", border: "1px solid #00ff8833" }}>
            Uniswap
          </a>
        </div>

        <div style={{ marginTop: "3rem", paddingTop: "1rem", borderTop: "1px solid #1a1a1a", color: "#333", fontSize: "0.75rem" }}>
          Rush &mdash; On-Chain Prediction Market on Base
        </div>
      </div>
    </div>
  );
}
