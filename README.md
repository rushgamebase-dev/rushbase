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
  <a href="https://basescan.org/address/0x6cE3873e31Ab5440fA6AF1860F8E36110504c9C4#code">RushTiles</a> &middot;
  <a href="https://x.com/rushgamebase">Twitter</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Chain-Base-0052FF?style=flat-square" />
  <img src="https://img.shields.io/badge/Contracts-Verified-00ff88?style=flat-square" />
  <img src="https://img.shields.io/badge/Tests-155%20passing-00ff88?style=flat-square" />
  <img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" />
</p>

---

## What is Rush?

Rush is a **fully on-chain prediction market** where users bet on real-world outcomes verified by computer vision. The protocol charges a flat 5% fee with **zero house edge** — winners split the entire pool.

Revenue flows to **100 protocol quotas** (tiles), making every holder a partner in the protocol.

### How It Works

1. **Watch** — Live traffic cameras stream 24/7 from real locations worldwide
2. **Predict** — Guess if the vehicle count goes OVER or UNDER the threshold in 5 minutes
3. **Win** — Correct predictions split the pool, all verified on-chain
4. **Earn** — Hold a quota to receive a share of every market's fees

---

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│  Frontend (Next.js 14, wagmi v2, Ably real-time)         │
│  rushgame.vip                                             │
├───────────────────────────────────────────────────────────┤
│  Smart Contracts (Base Mainnet, Solidity 0.8.24)         │
│  MarketFactory → PredictionMarket instances              │
│  RushTiles → 100 revenue-sharing quotas (Harberger tax)  │
│  OracleRegistry, DataAttestation, ConsensusEngine        │
│  DisputeManager                                           │
├───────────────────────────────────────────────────────────┤
│  Oracle (Python, YOLOv8x, BoT-SORT, WebSocket)          │
│  Real-time vehicle detection & counting                   │
│  Creates, locks, resolves markets on-chain                │
│  Evidence frames with SHA-256 hashes                      │
└───────────────────────────────────────────────────────────┘
```

---

## Smart Contracts

All contracts are **open source** and **verified on Basescan**.

### Deployed Addresses (Base Mainnet)

| Contract | Address | Source |
|----------|---------|--------|
| **MarketFactory** | [`0x5b04F3DFaE780A7e109066E754d27f491Af55Af9`](https://basescan.org/address/0x5b04F3DFaE780A7e109066E754d27f491Af55Af9#code) | [`MarketFactory.sol`](contracts/src/MarketFactory.sol) |
| **RushTiles** | [`0x6cE3873e31Ab5440fA6AF1860F8E36110504c9C4`](https://basescan.org/address/0x6cE3873e31Ab5440fA6AF1860F8E36110504c9C4#code) | [`RushTiles.sol`](contracts/src/RushTiles.sol) |

### Contract Overview

| Contract | Purpose |
|----------|---------|
| **MarketFactory** | Deploys new `PredictionMarket` instances for each round |
| **PredictionMarket** | Holds bets, resolves outcomes, distributes winnings |
| **RushTiles** | 100 revenue-sharing quotas with Harberger tax economics |
| **OracleRegistry** | Oracle staking, registration, and slashing |
| **DataAttestation** | Commit-reveal scheme for oracle honesty |
| **ConsensusEngine** | Multi-oracle median consensus with tolerance |
| **DisputeManager** | Post-resolution dispute handling |

### Market Lifecycle

```
OPEN ────> LOCKED ────> RESOLVED
  │                        │
  │ (no bets)              │ (auto-distribute to winners)
  v                        v
CANCELLED              distributeAll()
  │
  v
refundAll()
```

### Pari-Mutuel Odds

There is no house edge. Odds are determined purely by the pool distribution:

```
Distributable Pool = Total Pool × 95% (after 5% protocol fee)
Your Payout = (Your Bet / Winning Side Pool) × Distributable Pool
```

The 5% fee is hardcoded in the contract and **cannot be changed by anyone**.

---

## Revenue Sharing (Quotas)

Rush has **100 protocol quotas** (tiles). Each quota = 1 share of the protocol's revenue.

### What Flows to Quota Holders

| Source | Rate | Distribution |
|--------|------|-------------|
| Prediction market fees | 5% of every pool | 100% to treasury (distributed to holders) |
| $RUSH token trading fees | 100% of creator fees | Direct to holders |
| Harberger tax | 5%/week on self-assessed value | 50% holders, 50% protocol |
| Buyout fees | 10% of effective price | 40% holders, 60% protocol |
| Appreciation tax | 30% of price increase | 40% holders, 60% protocol |

### Harberger Tax Model

- **Self-assessment**: You set the price of your quota — anyone can buy it at that price
- **Weekly tax**: 5% of your declared price, paid from your deposit
- **Buyout**: Anyone can force-buy your quota by paying the effective price + fees
- **Price decay**: 20% per 2-week period prevents speculative hoarding
- **Max 5 per wallet**: Prevents monopolization

---

## Oracle System

The Rush Oracle uses **YOLOv8x** with **BoT-SORT** tracking for real-time vehicle counting:

- Line-crossing detection with cross-product geometry
- Temporal smoothing and de-duplication (60px radius, 3s window)
- Evidence frames captured every 30 seconds with SHA-256 hashes
- Commit-reveal attestation to prevent oracle collusion
- Adaptive threshold based on rolling average of last 5 rounds

### Supported Cameras

| Region | Type |
|--------|------|
| Fort Erie, Canada (Peace Bridge) | YouTube Live |
| Netherlands Highway | YouTube Live |
| Los Angeles Freeways (Caltrans) | HLS |
| Sao Paulo Highways (DER-SP) | JPEG Polling |

---

## Development

### Smart Contracts

```bash
cd contracts
forge install          # Install OpenZeppelin + forge-std
forge build            # Compile all contracts
forge test             # Run 155 tests
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
python3 round_manager_rush.py --rounds 3  # Test mode
```

---

## Security

| Measure | Status |
|---------|--------|
| Unit tests | 155 passing |
| Static analysis (Slither) | Zero critical vulnerabilities |
| ReentrancyGuard | All payable functions (OpenZeppelin) |
| Checks-effects-interactions | Enforced throughout |
| Contract verification | Verified on Basescan |
| Emergency withdraw | 90-day timelock |
| Dispute mechanism | Challenger deposit + arbitration |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Chain** | Base Mainnet (EVM, 2s blocks) |
| **Contracts** | Solidity 0.8.24, Foundry, OpenZeppelin |
| **Frontend** | Next.js 14, TypeScript, wagmi v2, viem, Tailwind, Framer Motion |
| **Real-time** | Ably (market events), WebSocket (vehicle count stream) |
| **Oracle** | Python, YOLOv8x, BoT-SORT, Supervision, OpenCV |
| **Infrastructure** | Vercel, Chainstack RPC, ngrok |

---

## License

MIT — see [LICENSE](LICENSE).

---

<p align="center">
  <strong>Transparent. Verifiable. No house edge.</strong><br/>
  Built on Base.
</p>
