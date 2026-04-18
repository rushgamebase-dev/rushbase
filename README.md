<p align="center">
  <img src="frontend/public/logo.png" width="80" alt="Rush logo" />
</p>

<h1 align="center">Rush Protocol</h1>

<p align="center">
  <strong>On-chain prediction market with AI-verified outcomes on Base</strong>
</p>

<p align="center">
  <a href="https://rushgame.vip">Live App</a> &middot;
  <a href="https://basescan.org/address/0x5b04F3DFaE780A7e109066E754d27f491Af55Af9#code">MarketFactory</a> &middot;
  <a href="https://basescan.org/address/0x5b7b2a6AC4f3A017fb943C9F550d609174532fFF#code">RushTiles V2</a> &middot;
  <a href="https://basescan.org/address/0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b">$RUSH Token</a> &middot;
  <a href="https://x.com/rushgamebase">Twitter</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Chain-Base-0052FF?style=flat-square" />
  <img src="https://img.shields.io/badge/Contracts-Verified-00ff88?style=flat-square" />
  <img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" />
</p>

---

## What is Rush?

Rush is a **fully on-chain prediction market** where users bet ETH on real-world outcomes verified by computer vision. Winners split **95% of the pool**, the remaining **5% flows to tile holders**, and the protocol takes **zero**.

The protocol has two revenue-sharing products working together:

- **ETH Markets** (MarketFactory + PredictionMarket) -- pari-mutuel betting on live camera outcomes. 95% to winners, 5% to RushTiles holders.
- **RushTiles V1 + V2** -- two 100-tile Harberger-taxed grids. Each tile owner receives a share of every market fee and external ETH routed to the contract.

The **$RUSH token** is the protocol's trading asset on Flaunch; creator fees from its trading activity flow to RushTiles V1 holders.

### How It Works

1. **Watch** -- Live traffic cameras stream 24/7 from real locations
2. **Predict** -- Guess if the vehicle count goes OVER or UNDER the threshold in 5 minutes
3. **Win** -- Correct predictions split 95% of the pool; proof-of-outcome frames are posted on every resolution
4. **Earn** -- Hold a RushTile to receive a share of every market fee and the $RUSH trading fees (V1)

---

## Architecture

```
+-------------------------------------------------------------+
|  Frontend (Next.js 14, wagmi v2, Ably real-time)            |
|  rushgame.vip (Vercel)                                      |
+-------------------------------------------------------------+
         |                    |                    |
         v                    v                    v
+------------------+  +------------------+  +------------------+
| MarketFactory    |  | RushTiles V1/V2  |  | $RUSH Token      |
| + PredictionMkt  |  | 100 tiles each   |  | Flaunch-managed  |
| ETH markets      |  | Harberger tax    |  | trading fees to  |
| 5% to tiles      |  | Revenue sharing  |  | V1 tile holders  |
+------------------+  +------------------+  +------------------+
         \                    |                    /
          \                   |                   /
           v                  v                  v
+-------------------------------------------------------------+
|  Base Mainnet (EVM, 2s blocks)                              |
+-------------------------------------------------------------+
                              ^
                              |
+-------------------------------------------------------------+
|  Oracle Engine (Python, Computer Vision, GPU)               |
|  Real-time vehicle detection, evidence frames, SHA-256      |
|  WebSocket broadcast, tunneled to clients                   |
+-------------------------------------------------------------+
                              ^
                              |
+-------------------------------------------------------------+
|  Live Camera Feed (HLS / YouTube Live)                      |
|  Current rotation: Konya, Turkey                            |
+-------------------------------------------------------------+
```

---

## Smart Contracts

All production contracts are **open source** and **verified on Basescan**.

### Deployed Addresses (Base Mainnet)

| Contract | Address | Status |
|----------|---------|--------|
| **MarketFactory** | [`0x5b04F3DFaE780A7e109066E754d27f491Af55Af9`](https://basescan.org/address/0x5b04F3DFaE780A7e109066E754d27f491Af55Af9#code) | Production |
| **RushTiles V2** (Series 2) | [`0x5b7b2a6AC4f3A017fb943C9F550d609174532fFF`](https://basescan.org/address/0x5b7b2a6AC4f3A017fb943C9F550d609174532fFF#code) | Production |
| **RushTiles V1** (Series 1) | [`0x6cE3873e31Ab5440fA6AF1860F8E36110504c9C4`](https://basescan.org/address/0x6cE3873e31Ab5440fA6AF1860F8E36110504c9C4#code) | Production |
| **$RUSH Token** | [`0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b`](https://basescan.org/address/0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b) | Production (trading) |
| BurnMarketFactory | [`0xf3edae04f632bc4cfde9a08e06f36a17bfaee83f`](https://basescan.org/address/0xf3edae04f632bc4cfde9a08e06f36a17bfaee83f#code) | Archived |

**Oracle/Admin:** `0x4c385830c2E241EfeEd070Eb92606B6AedeDA277`
**Fee Recipient (dev):** `0xdd12D83786C2BAc7be3D59869834C23E91449A2D`

### Contract Overview

| Contract | Purpose |
|----------|---------|
| **MarketFactory** | Deploys a new `PredictionMarket` instance per round |
| **PredictionMarket** | Holds ETH bets, resolves outcomes, distributes 95% to winners and 5% to tile holders |
| **RushTiles V1** | Series 1 -- 100 tiles, 1 share each, max 5 per wallet, Flaunch integration |
| **RushTiles V2** | Series 2 -- 100 tiles, Founder tier (0.5 ETH, 5 shares, buyout-immune) + Normal tier (0.1 ETH, 1 share) |
| BurnMarketFactory / BurnMarket | Archived -- earlier $RUSH-denominated market format with 70/30 burn split |
| OracleRegistry | Dormant -- oracle staking and slashing framework ready for multi-oracle |
| DataAttestation | Dormant -- commit-reveal scheme for oracle honesty |
| ConsensusEngine | Dormant -- multi-oracle median consensus with tolerance |
| DisputeManager | Dormant -- post-resolution dispute handling |

### Market Lifecycle

```
OPEN --> LOCKED --> RESOLVED
  |                    |
  | (no bets /         | (auto-distribute to winners)
  |  one-sided)        |
  v                    v
CANCELLED          distributeAll()
  |
  v
refundAll()
```

**Round timing:** 150s betting window + 150s counting = 5 min total round.

### Pari-Mutuel Odds

There is no house edge. Odds are determined purely by the pool distribution:

```
Protocol Fee = Total Pool x 5% (to RushTiles holders)
Distributable Pool = Total Pool x 95%
Your Payout = (Your Bet / Winning Side Pool) x Distributable Pool
```

The 5% rate is hardcoded in the contract and **cannot be changed by anyone**.

---

## $RUSH Token

$RUSH is the protocol's trading asset, launched on [Flaunch](https://flaunch.gg).

- **Contract:** [`0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b`](https://basescan.org/address/0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b)
- **DexScreener:** [dexscreener.com/base/0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b](https://dexscreener.com/base/0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b)

### Flaunch Trading Fees

Flaunch creator fees from $RUSH trading are claimable by RushTiles V1 (100% to V1 holders). This makes $RUSH volume an additional revenue source for tile holders, on top of market fees.

See [docs/TOKEN.md](docs/TOKEN.md) for full details.

---

## Revenue Sharing (RushTiles)

Rush has two independent series of **100 protocol tiles** each. Each tile represents a share of the protocol's revenue.

### V1 vs V2 Fee Splits

| Revenue Source | V1 (Series 1) | V2 (Series 2) |
|---------------|----------------|----------------|
| ETH market fees (5% of pool) | Routed to V1 (100% holders) | Can be routed to V2 (100% holders) |
| Flaunch trading fees | 100% to V1 holders | n/a |
| Harberger tax (5%/week) | 50% holders / 50% dev | 30% holders / 70% dev |
| Buyout fees (10%) | 40% holders / 60% dev | 100% dev |
| Claim fees (10%) | 40% holders / 60% dev | 100% dev |
| Appreciation tax (30%) | 40% holders / 60% dev | 100% dev |

### V2 Tile Tiers

| Tier | Upfront Price | Shares | Buyout |
|------|-----|--------|--------|
| **Founder** | 0.5 ETH | 5 shares | Cannot be bought out |
| **Normal** | 0.1 ETH | 1 share | Standard Harberger buyout |

### Harberger Tax Model

- **Self-assessment**: You set the price of your tile -- anyone can buy it at that price
- **Weekly tax**: 5% of your declared price, paid from your deposit
- **Buyout**: Anyone can force-buy at the effective price + fees (V2 Founder tiles excepted)
- **Price decay**: 20% per 2-week period prevents speculative hoarding
- **Foreclosure**: If your deposit runs out, anyone can call `pokeTax()` and you lose the tile

See [docs/TILES.md](docs/TILES.md) for the full tile economy reference.

---

## Oracle System

The Rush Oracle uses a proprietary computer vision pipeline for real-time vehicle counting on live traffic cameras.

### How It Works

- AI detects and tracks vehicles on live camera feeds
- Real-time vehicle counting with multi-object tracking
- Evidence frames captured every 30 seconds with SHA-256 hashes
- Adaptive threshold keeps markets balanced
- Multi-class support (cars, trucks, buses, motorcycles)

### Cameras

Multiple cameras worldwide with dynamic swap support. Current rotation:

| Camera | Location |
|--------|----------|
| **Konya, Turkey** | 1080p HD traffic camera |

Additional cameras are configured and can be swapped in: Indonesia, Korea, Netherlands, and others.

See [docs/ORACLE.md](docs/ORACLE.md) for the round lifecycle and evidence system.

---

## Development

### Smart Contracts

```bash
cd contracts
forge install          # Install OpenZeppelin + forge-std
forge build            # Compile all contracts
forge test             # Run tests
forge coverage         # Code coverage report
```

### Frontend

```bash
cd frontend
npm install
npm run dev            # http://localhost:3000
```

### Oracle

```bash
cd oracle
pip install -r requirements.txt
python3 watchdog.py    # Production (supervised)
```

---

## Security

| Measure | Status |
|---------|--------|
| Static analysis (Slither) | Zero critical vulnerabilities |
| ReentrancyGuard | All payable functions (OpenZeppelin) |
| Checks-effects-interactions | Enforced throughout |
| Contract verification | Verified on Basescan |
| Emergency withdraw | 90-day timelock (V1), 30-day timelock (V2) |
| Dispute mechanism | Challenger deposit + arbitration (dormant) |
| Evidence frames | SHA-256 hashes posted per resolution |

Report security issues to **rushonbase@gmail.com** -- see [SECURITY.md](SECURITY.md).

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Chain** | Base Mainnet (EVM, 2s blocks) |
| **Contracts** | Solidity 0.8.24, Foundry, OpenZeppelin |
| **Frontend** | Next.js 14, TypeScript, wagmi v2, viem, Tailwind, Framer Motion |
| **Real-time** | Ably (market events), WebSocket (detection stream) |
| **Oracle** | Python, Computer Vision, CUDA GPU |
| **Infrastructure** | Vercel, Cloudflare tunnels |

---

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) -- System architecture overview
- [docs/CONTRACTS.md](docs/CONTRACTS.md) -- Smart contract reference
- [docs/ORACLE.md](docs/ORACLE.md) -- Oracle round lifecycle and evidence
- [docs/TILES.md](docs/TILES.md) -- Full tile economy (V1 + V2)
- [docs/TOKEN.md](docs/TOKEN.md) -- $RUSH token details
- [docs/API.md](docs/API.md) -- REST + WebSocket API reference
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) -- Deployment guide

---

## Links

- **Website:** [rushgame.vip](https://rushgame.vip)
- **Twitter:** [@rushgamebase](https://x.com/rushgamebase)
- **$RUSH Token:** [DexScreener](https://dexscreener.com/base/0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b)
- **MarketFactory:** [Basescan](https://basescan.org/address/0x5b04F3DFaE780A7e109066E754d27f491Af55Af9#code)
- **RushTiles V2:** [Basescan](https://basescan.org/address/0x5b7b2a6AC4f3A017fb943C9F550d609174532fFF#code)
- **RushTiles V1:** [Basescan](https://basescan.org/address/0x6cE3873e31Ab5440fA6AF1860F8E36110504c9C4#code)

---

## License

MIT -- see [LICENSE](LICENSE).

---

<p align="center">
  <strong>Transparent. Verifiable. No house edge.</strong><br/>
  Built on Base.
</p>
