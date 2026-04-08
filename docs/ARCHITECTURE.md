# Rush Protocol -- Architecture Overview

Rush is a fully on-chain prediction market protocol on Base where AI observes live cameras and settles markets automatically. Users bet on real-world vehicle counts; an oracle powered by computer vision creates markets, watches the road, and resolves everything on-chain with cryptographic evidence.

---

## Subsystems

Five subsystems work together:

1. **Smart Contracts** (Base Mainnet) -- Market creation, betting, resolution, payout, tile economy
2. **Oracle Engine** (Python) -- AI detection, vehicle counting, on-chain settlement
3. **Frontend** (Next.js) -- User interface, wallet integration, real-time updates
4. **Real-Time Layer** -- WebSocket for live detection feed, Ably for market events
5. **Data Layer** -- Market history, user profiles, platform stats

---

## High-Level Diagram

```
                  Users (Browser + Wallet)
                          |
                          v
                +-----------------------+
                |  Frontend             |
                |  rushgame.vip         |
                +-----------------------+
                  |         |         |
                  v         v         v
           +---------+ +--------+ +--------+
           |Contracts| |Real-   | |Data    |
           |Base     | |Time    | |API     |
           |Chain    | |WS+Ably | |REST    |
           +---------+ +--------+ +--------+
                ^           ^
                |           |
           +-----------------------+
           |  Oracle Engine        |
           |  AI Detection +       |
           |  On-Chain Settlement  |
           +-----------------------+
                     ^
                     |
              +-------------+
              |Live Cameras |
              |Worldwide    |
              +-------------+
```

---

## Smart Contracts

Three contract systems coexist on Base Mainnet:

- **$RUSH Markets** (BurnMarketFactory -> BurnMarket): Token betting with 30% burn on resolution. The primary market type.
- **ETH Markets** (MarketFactory -> PredictionMarket): Legacy ETH betting with a 5% platform fee.
- **Tile Economy** (RushTiles V1 + V2): Revenue-sharing tiles with Harberger tax mechanics. Tile owners earn a share of platform fees.

Dormant infrastructure is deployed and ready for future activation: OracleRegistry, DataAttestation, ConsensusEngine, DisputeManager.

All contracts are verified on Basescan. See [CONTRACTS.md](CONTRACTS.md) for addresses and details.

---

## Oracle Engine

The oracle is the bridge between the physical world and the blockchain:

- Connects to live traffic cameras worldwide
- YOLOv8x for vehicle detection, BoT-SORT for multi-object tracking
- Counts vehicles crossing a defined line, captures evidence frames with SHA-256 hashes
- Creates markets on-chain, resolves them with the actual count, and auto-distributes winnings
- Currently operates as a single oracle operator; multi-oracle infrastructure is deployed and ready

See [ORACLE.md](ORACLE.md) for the round lifecycle and evidence system.

---

## Frontend

Next.js 14 deployed on Vercel. Key features:

- **wagmi v2** for wallet connection and contract interactions
- **Real-time vehicle count** via WebSocket -- users see vehicles counted live
- **Ably** for market lifecycle events pushed to all connected clients
- **Pages**: main game (`/`), tiles (`/tiles`), series 2 (`/series2`), stats (`/stats`), profile (`/profile/[address]`), docs (`/docs`), admin (`/admin`)
- **13 API endpoints** for market data, stats, chat, and profiles

See [API.md](API.md) for the endpoint reference.

---

## Real-Time Layer

Two independent channels serve different purposes:

- **WebSocket**: Live vehicle detection stream. Every detection event is pushed to connected clients so the count updates in real-time during an active round.
- **Ably**: Market lifecycle events (created, resolved, cancelled). Reliable pub/sub that pushes state changes to all connected browsers.

---

## Data Flow -- Happy Path of a Round

1. **Oracle creates market** on-chain -> Ably broadcasts `market_created`
2. **Frontend shows market**, users place bets via wallet (wagmi -> contract)
3. **Oracle broadcasts live count** via WebSocket as vehicles are detected
4. **Betting window closes** -> `lockMarket()` is called on-chain
5. **Counting continues**, evidence frames are captured and hashed
6. **Round ends** -> `resolveMarket(count)` is called -> 30% of the pot is burned, 70% goes to winners
7. **`distributeAll()`** auto-pays all winners -> Ably broadcasts `market_resolved`
8. **Market data** is posted to the ledger API for history and stats

---

## Tech Stack

| Layer | Technology |
|-----------|---------------------------------------------|
| Chain | Base Mainnet (EVM, 2-second blocks) |
| Contracts | Solidity 0.8.24, Foundry, OpenZeppelin |
| Frontend | Next.js 14, TypeScript, wagmi v2, viem, Tailwind CSS, Framer Motion |
| Real-time | Ably (market events), WebSocket (detection) |
| Oracle | Python, YOLOv8x, BoT-SORT, OpenCV |
| Hosting | Vercel (frontend), Cloudflare (tunnel) |
