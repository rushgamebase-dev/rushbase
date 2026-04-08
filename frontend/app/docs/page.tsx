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
  sectionNote: { background: "#111", border: "1px solid #1a1a1a", borderRadius: 6, padding: "0.75rem 1rem", marginBottom: "1rem", fontSize: "0.85rem", color: "#888" } as const,
  tagLegacy: { display: "inline-block", padding: "1px 7px", borderRadius: 3, fontSize: "0.7rem", fontWeight: 700, background: "#2a1a00", color: "#ffaa00", border: "1px solid #ffaa0033", marginLeft: "0.5rem", verticalAlign: "middle" } as const,
  tagCurrent: { display: "inline-block", padding: "1px 7px", borderRadius: 3, fontSize: "0.7rem", fontWeight: 700, background: "#0a2a0a", color: "#00ff88", border: "1px solid #00ff8833", marginLeft: "0.5rem", verticalAlign: "middle" } as const,
};

export default function DocsPage() {
  return (
    <div style={S.page}>
      <Header />
      <div style={S.container}>
        <h1 style={S.h1}>Rush Documentation</h1>
        <p style={S.p}>
          Rush is a fully on-chain, AI-powered prediction market on{" "}
          <strong style={{ color: "#e0e0e0" }}>Base Mainnet</strong>. Users bet on real-world outcomes
          observed by computer vision. 100 Harberger-tax tiles (Socios) earn protocol revenue.
          $RUSH markets are deflationary — 30% of every pool is burned forever.
        </p>

        {/* ─── Contracts & Token ─── */}
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
              <td style={S.td}>
                BurnMarketFactory
                <span style={S.tagCurrent}>current</span>
              </td>
              <td style={S.td}>
                <a href={`https://basescan.org/address/${FACTORY_ADDRESS}`} target="_blank" rel="noopener noreferrer" style={S.link}>
                  <code style={S.addr}>{FACTORY_ADDRESS}</code>
                </a>
              </td>
            </tr>
            <tr>
              <td style={S.td}>
                MarketFactory
                <span style={S.tagLegacy}>legacy · ETH</span>
              </td>
              <td style={S.td}>
                <a href={`https://basescan.org/address/${OLD_ETH_FACTORY}`} target="_blank" rel="noopener noreferrer" style={S.link}>
                  <code style={S.addr}>{OLD_ETH_FACTORY}</code>
                </a>
              </td>
            </tr>
            <tr>
              <td style={S.td}>RushTiles Series 1 (V1)</td>
              <td style={S.td}>
                <a href={`https://basescan.org/address/${RUSH_TILES_ADDRESS}`} target="_blank" rel="noopener noreferrer" style={S.link}>
                  <code style={S.addr}>{RUSH_TILES_ADDRESS}</code>
                </a>
              </td>
            </tr>
            <tr>
              <td style={S.td}>RushTiles Series 2 (V2)</td>
              <td style={S.td}>
                <a href={`https://basescan.org/address/${RUSH_TILES_V2_ADDRESS}`} target="_blank" rel="noopener noreferrer" style={S.link}>
                  <code style={S.addr}>{RUSH_TILES_V2_ADDRESS}</code>
                </a>
              </td>
            </tr>
          </tbody>
        </table>

        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
          <a
            href={`https://flaunch.gg/base/coins/${RUSH_TOKEN_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...S.badge, background: "#1a2a1a", color: "#00ff88", border: "1px solid #00ff8833" }}
          >
            Buy $RUSH on Flaunch
          </a>
          <a
            href={`https://dexscreener.com/base/${RUSH_TOKEN_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...S.badge, background: "#1a1a2a", color: "#88aaff", border: "1px solid #88aaff33" }}
          >
            DexScreener
          </a>
        </div>

        {/* ─── How Markets Work ─── */}
        <h2 style={S.h2}>How Markets Work</h2>
        <p style={S.p}>
          Each round, an AI model (YOLOv8) counts vehicles on a live traffic camera. Users bet on
          whether the count will be Under or Over a threshold. Two market modes exist:
        </p>

        <h3 style={S.h3}>$RUSH Markets <span style={S.tagCurrent}>current</span></h3>
        <p style={S.p}>
          Bet with $RUSH tokens. Winners receive 70% of the pool proportional to their stake.
          30% is burned to <code style={{ ...S.addr, display: "inline" }}>0x000...dEaD</code> permanently.
          Zero protocol fees. Every market makes $RUSH more scarce.
        </p>
        <pre style={S.code}>{`OPEN (bets in $RUSH) -> LOCKED (counting) -> RESOLVED
                                                    |
                              70% pool -> winners (pari-mutuel)
                              30% pool -> 0x000...dEaD (burned forever)`}</pre>

        <h3 style={S.h3}>ETH Markets <span style={S.tagLegacy}>legacy</span></h3>
        <p style={S.p}>
          Bet with ETH. Winners split 95% of the pool proportional to their stake.
          5% goes to the treasury and is distributed to RushTiles Series 1 holders. Pari-mutuel, no house edge.
        </p>
        <pre style={S.code}>{`OPEN (bets in ETH) -> LOCKED (counting) -> RESOLVED
                                                  |
                            95% pool -> winners (pari-mutuel)
                             5% fee -> treasury -> Series 1 tile holders`}</pre>

        {/* ─── $RUSH Token & Burn ─── */}
        <h2 style={S.h2}>$RUSH Token & Burn Mechanics</h2>
        <p style={S.p}>
          $RUSH is a deflationary ERC-20 token launched via Flaunch on Base. It is the betting
          currency for all current markets. Every resolved $RUSH market burns 30% of the total pool
          to the dead address — no minting, no recovery.
        </p>
        <div style={S.sectionNote}>
          <strong style={{ color: "#e0e0e0" }}>Burn address:</strong>{" "}
          <code style={{ ...S.addr, display: "inline" }}>0x000000000000000000000000000000000000dEaD</code>
        </div>
        <table style={S.table}>
          <thead><tr><th style={S.th}>Mechanic</th><th style={S.th}>Detail</th></tr></thead>
          <tbody>
            <tr><td style={S.td}>Winners</td><td style={S.td}>70% of pool, proportional to bet size</td></tr>
            <tr><td style={S.td}>Burned</td><td style={S.td}>30% of pool sent to <code style={{ ...S.addr, display: "inline" }}>0x000...dEaD</code></td></tr>
            <tr><td style={S.td}>Protocol fees</td><td style={{...S.td, color:"#00ff88"}}>Zero</td></tr>
            <tr><td style={S.td}>Effect</td><td style={S.td}>Continuous deflation as protocol volume grows</td></tr>
            <tr><td style={S.td}>Buy</td><td style={S.td}>Flaunch · DexScreener (links above)</td></tr>
          </tbody>
        </table>

        {/* ─── Tiles Series 1 ─── */}
        <h2 style={S.h2}>RushTiles Series 1 <span style={S.tagLegacy}>V1</span></h2>
        <p style={S.p}>
          100 tiles on a 10x10 grid. Each tile = 1 share of ETH market revenue. Harberger tax model:
          declare a price, pay weekly tax on it, anyone can force-buy you out at that price.
          Trading fees from the Flaunch pool also flow 100% to Series 1 holders.
        </p>

        <h3 style={S.h3}>Series 1 Parameters</h3>
        <table style={S.table}>
          <thead><tr><th style={S.th}>Parameter</th><th style={S.th}>Value</th></tr></thead>
          <tbody>
            <tr><td style={S.td}>Grid Size</td><td style={S.td}>100 tiles (fixed)</td></tr>
            <tr><td style={S.td}>Max Per Wallet</td><td style={S.td}>5 tiles</td></tr>
            <tr><td style={S.td}>Shares Per Tile</td><td style={S.td}>1 share</td></tr>
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
            <tr><td style={S.td}>Claim Fees</td><td style={S.td}>Owner</td><td style={S.td}>Withdraw accumulated ETH commissions.</td></tr>
          </tbody>
        </table>

        {/* ─── Tiles Series 2 ─── */}
        <h2 style={S.h2}>RushTiles Series 2 <span style={S.tagCurrent}>V2</span></h2>
        <p style={S.p}>
          100 tiles with two tiers: Founder tiles (limited, protected) and Normal tiles. Series 2
          introduces multi-share Founder slots and a revised fee model that routes most fees to the dev
          wallet, while external ETH received by the contract (e.g. from Flaunch) goes 100% to holders.
        </p>

        <h3 style={S.h3}>Series 2 Tiers</h3>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Tier</th>
              <th style={S.th}>Min Price</th>
              <th style={S.th}>Shares</th>
              <th style={S.th}>Buyout</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ ...S.td, color: "#ffd700" }}>Founder</td>
              <td style={S.td}>0.5 ETH</td>
              <td style={S.td}>5 shares</td>
              <td style={{ ...S.td, color: "#ff6666" }}>Cannot be bought out</td>
            </tr>
            <tr>
              <td style={S.td}>Normal</td>
              <td style={S.td}>0.1 ETH</td>
              <td style={S.td}>1 share</td>
              <td style={S.td}>Can be bought out</td>
            </tr>
          </tbody>
        </table>

        {/* ─── Fee Distribution ─── */}
        <h2 style={S.h2}>Fee Distribution</h2>

        <h3 style={S.h3}>Series 1 Fee Splits</h3>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Source</th>
              <th style={S.th}>Rate</th>
              <th style={S.th}>Holders</th>
              <th style={S.th}>Dev</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={S.td}>Market fees (ETH markets)</td>
              <td style={S.td}>5% of ETH pool</td>
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
              <td style={S.td}>Buyout + appreciation</td>
              <td style={S.td}>10% + 30%</td>
              <td style={S.td}>40%</td>
              <td style={S.td}>60%</td>
            </tr>
            <tr>
              <td style={S.td}>Claim fee (2nd+ tile)</td>
              <td style={S.td}>10% of price</td>
              <td style={S.td}>40%</td>
              <td style={S.td}>60%</td>
            </tr>
          </tbody>
        </table>

        <h3 style={S.h3}>Series 2 Fee Splits</h3>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Source</th>
              <th style={S.th}>Rate</th>
              <th style={S.th}>Holders</th>
              <th style={S.th}>Dev</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={S.td}>External ETH (receive)</td>
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
              <td style={S.td}>Buyout fee</td>
              <td style={S.td}>10%</td>
              <td style={S.td}>0%</td>
              <td style={{ ...S.td, color: "#ffd700" }}>100%</td>
            </tr>
            <tr>
              <td style={S.td}>Appreciation tax</td>
              <td style={S.td}>30%</td>
              <td style={S.td}>0%</td>
              <td style={{ ...S.td, color: "#ffd700" }}>100%</td>
            </tr>
            <tr>
              <td style={S.td}>Claim fee</td>
              <td style={S.td}>10%</td>
              <td style={S.td}>0%</td>
              <td style={{ ...S.td, color: "#ffd700" }}>100%</td>
            </tr>
          </tbody>
        </table>

        <pre style={S.code}>{`Series 1 fees arrive -> Treasury -> distributeFees() -> globalRewardPerShare increases
                                                               |
                              Each tile = 1 share -> claimFees() -> ETH to your wallet

Series 2 external ETH -> receive() -> distributed immediately to holders (by share count)
Series 2 Founder tile = 5 shares | Normal tile = 1 share`}</pre>

        <h3 style={S.h3}>Commission Example (Series 1)</h3>
        <p style={S.p}>
          You own 2 tiles. 80 tiles are active. A market resolves with a 10 ETH pool.
        </p>
        <pre style={S.code}>{`Protocol fee: 10 ETH * 5% = 0.5 ETH -> treasury
Per tile: 0.5 / 80 = 0.00625 ETH
Your commission: 0.00625 * 2 = 0.0125 ETH`}</pre>

        {/* ─── Security ─── */}
        <h2 style={S.h2}>Security</h2>
        <p style={S.p}>
          All contracts verified on Basescan. ReentrancyGuard (OpenZeppelin) on all payable functions.
          Checks-effects-interactions pattern throughout. Emergency withdraw requires 90 days of
          inactivity before it can be triggered.
        </p>

        {/* ─── Links ─── */}
        <h2 style={S.h2}>Links</h2>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <a
            href="https://rushgame.vip"
            style={{ ...S.badge, background: "#1a1a1a", color: "#ffd700", border: "1px solid #ffd70033" }}
          >
            rushgame.vip
          </a>
          <a
            href={`https://basescan.org/token/${RUSH_TOKEN_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...S.badge, background: "#1a1a1a", color: "#aaa", border: "1px solid #333" }}
          >
            Basescan
          </a>
          <a
            href={`https://flaunch.gg/base/coins/${RUSH_TOKEN_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...S.badge, background: "#1a2a1a", color: "#00ff88", border: "1px solid #00ff8833" }}
          >
            Flaunch
          </a>
          <a
            href={`https://dexscreener.com/base/${RUSH_TOKEN_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...S.badge, background: "#1a1a2a", color: "#88aaff", border: "1px solid #88aaff33" }}
          >
            DexScreener
          </a>
        </div>

        <div style={{ marginTop: "3rem", paddingTop: "1rem", borderTop: "1px solid #1a1a1a", color: "#333", fontSize: "0.75rem" }}>
          Rush &mdash; On-Chain Prediction Market on Base
        </div>
      </div>
    </div>
  );
}
