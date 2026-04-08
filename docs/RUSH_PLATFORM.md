# Rush - On-Chain Prediction Market

## Overview

Rush is a fully on-chain, AI-powered prediction market deployed on **Base Mainnet** where users bet on real-world outcomes observed by computer vision. The first market type counts vehicles on live traffic cameras using YOLOv8, but the architecture is designed to support any observable, verifiable event -- including crypto price predictions (BTC 5min, ETH 1min, etc.).

**Key Properties:**
- **Pari-mutuel model** -- no house edge, winners split the entire pool minus a flat 5% protocol fee
- **AI-verified outcomes** -- YOLOv8x object detection with BoT-SORT multi-object tracking, cryptographically attested evidence frames
- **Revenue sharing** -- 100 Harberger-tax tiles (Socios) earn proportional shares of all protocol fees
- **Fully transparent** -- every bet, resolution, and payout is an on-chain transaction verifiable on Basescan

**Live at:** [rushgame.vip](https://rushgame.vip)

---

## Architecture

```
                          +------------------------------+
                          |   Frontend (Next.js 14)      |
                          |   wagmi v2 + viem            |
                          |   Ably real-time             |
                          +---------+--------------------+
                                    |
                     +--------------+--------------+
                     |                             |
           +---------v----------+       +----------v---------+
           | Smart Contracts    |       | Oracle (Python)    |
           | Base Mainnet       |       | YOLOv8 + BoT-SORT |
           | Solidity 0.8.24   |       | WebSocket 8765     |
           +--------------------+       +--------------------+
                     |                             |
           +---------v----------+       +----------v---------+
           | MarketFactory      |       | Watchdog           |
           | PredictionMarket   |       | round_manager_rush |
           | RushTiles          |       | stream_server      |
           | OracleRegistry     |       | signer (attestation|
           | DataAttestation    |       | orphan_recovery    |
           | ConsensusEngine    |       +--------------------+
           | DisputeManager     |
           +--------------------+       +--------------------+
                                        | Infrastructure     |
                                        | Redis (ledger)     |
                                        | Ably (pub/sub)     |
                                        | ngrok (tunnels)    |
                                        +--------------------+
```

---

## Smart Contracts

All contracts are deployed and verified on Base Mainnet.

| Contract | Address | Purpose |
|----------|---------|---------|
| **MarketFactory** | `0x5b04F3DFaE780A7e109066E754d27f491Af55Af9` | Deploys new prediction market instances per round |
| **PredictionMarket** | *(per round)* | Holds bets, resolves outcomes, distributes winnings |
| **RushTiles** | `0x6cE3873e31Ab5440fA6AF1860F8E36110504c9C4` | 100-tile revenue-sharing grid with Harberger tax |
| **OracleRegistry** | *(deployed)* | Oracle staking, registration, slashing |
| **DataAttestation** | *(deployed)* | Commit-reveal scheme for oracle honesty |
| **ConsensusEngine** | *(deployed)* | Multi-oracle median + tolerance consensus |
| **DisputeManager** | *(deployed)* | Post-resolution dispute handling |

**Key Addresses:**
- Oracle Signer: `0x4c385830c2E241EfeEd070Eb92606B6AedeDA277`
- Fee Recipient (Treasury): `0xdd12D83786C2BAc7be3D59869834C23E91449A2D`

---

## Market Lifecycle

Each prediction market follows a strict state machine:

```
  OPEN ──────> LOCKED ──────> RESOLVED
   │                              │
   │ (no bets / one-sided)        │ (winners claim)
   v                              v
  CANCELLED                   distributeAll()
   │
   v
  refundAll()
```

### Phase 1: OPEN (0 to BETTING_WINDOW seconds)

1. The Oracle creates a new market on-chain via `MarketFactory.createMarket()`.
2. The market deploys with:
   - A **stream URL** (live camera feed)
   - A **description** (e.g., "Peace Bridge -- How many vehicles in 5 min?")
   - Two **ranges**: Under X and Over X (where X = adaptive threshold)
   - Bet limits: 0.001 ETH min, 1 ETH max
3. Users place bets by calling `placeBet(rangeIndex)` with ETH.
4. Bets accumulate in two pools: `poolByRange[0]` (Under) and `poolByRange[1]` (Over).
5. Ably broadcasts `market_created` so the frontend picks it up instantly.

### Phase 2: LOCKED (BETTING_WINDOW to ROUND_DURATION)

1. At BETTING_WINDOW seconds (default 150s), the contract's `lockTime` is reached.
2. No new bets are accepted.
3. The AI counting continues -- vehicles are still being detected and tracked.
4. Users watch the live count via WebSocket stream, but can no longer bet.

### Phase 3: RESOLVED

1. The Oracle reads the final vehicle count from `result.json`.
2. **Pool validation**: If `totalPool == 0` or one side has zero bets, the market is **cancelled** and all bets refunded.
3. Otherwise, the Oracle calls `resolveMarket(actualCarCount)`.
4. The contract determines which range the count falls into:
   - Range 0 (Under): `0 <= count <= threshold`
   - Range 1 (Over): `threshold + 1 <= count`
5. A 5% fee is taken from the total pool and sent to the treasury.
6. Winners claim their proportional share of the remaining 95%.

### Auto-Distribution

After resolution, the Oracle calls `distributeAll()` to automatically pay all winners. Users don't need to manually claim -- winnings arrive in their wallets.

---

## Odds & Payouts

Rush uses a **pari-mutuel** system. Odds are determined by the ratio of the total distributable pool to the winning side's pool.

**Formula:**

```
Distributable Pool (DP) = Total Pool * 0.95   (after 5% fee)

Over Odds  = DP / Over Pool
Under Odds = DP / Under Pool

User Payout = User Bet * (DP / Winning Pool)
User Profit = User Payout - User Bet
```

**Example:**

| Metric | Value |
|--------|-------|
| Total Pool | 10 ETH |
| Under Pool | 6 ETH |
| Over Pool | 4 ETH |
| Distributable Pool | 9.5 ETH |
| Under Odds | 9.5 / 6 = **1.583x** |
| Over Odds | 9.5 / 4 = **2.375x** |

A user who bets 1 ETH on Over and wins receives **2.375 ETH** (profit: 1.375 ETH).

---

## Adaptive Threshold

The threshold (the dividing line between Under and Over) adapts based on actual traffic:

- **Rolling window**: Last 5 round counts per camera
- **Calculation**: Simple average of the window
- **Bounds**: Clamped to [20, 200] vehicles
- **Initial**: 50 vehicles (until history fills)

This keeps markets balanced -- if traffic is consistently high, the threshold rises; if low, it drops. This maximizes the probability of roughly even pools and competitive odds.

---

## Oracle System

### Overview

The Rush Oracle is a Python service that orchestrates the entire round lifecycle:

1. **Creates** prediction markets on-chain
2. **Spawns** a real-time vehicle detection subprocess
3. **Streams** live counts to the frontend via WebSocket
4. **Resolves** markets with the final count
5. **Distributes** winnings automatically
6. **Records** evidence for transparency

### Components

#### round_manager_rush.py (Orchestrator)

The main loop that runs indefinitely (or for N rounds in test mode):

```
for each round:
    1. Pick camera (alternates: Peace Bridge <-> Netherlands Highway)
    2. Create market on-chain with adaptive threshold
    3. Spawn stream_server.py subprocess
    4. Wait for counting duration to complete
    5. Read result.json with final count
    6. Validate pools (cancel if empty/one-sided)
    7. Resolve market on-chain
    8. Auto-distribute winnings
    9. Update adaptive threshold
    10. POST round record to ledger API
    11. Wait 15s inter-round gap
```

**Key features:**
- Orphan market detection on startup (cancels stuck markets from crashes)
- Transaction retry logic (3 attempts with exponential backoff)
- Ably event broadcasting for instant frontend updates
- Graceful shutdown on SIGTERM/SIGINT

#### stream_server.py (AI Detection Engine)

Real-time vehicle detection and counting:

- **Model**: YOLOv8x (68M parameters, highest accuracy)
- **Tracker**: BoT-SORT with custom config for traffic scenarios
- **Counting method**: Line-crossing detection using cross-product geometry
- **Vehicle classes**: Cars (2), Motorcycles (3), Buses (5), Trucks (7)
- **Confidence threshold**: 15%
- **De-duplication**: 60px radius + 3-second window prevents double-counting
- **Temporal smoothing**: 3-frame detection smoother reduces jitter
- **Overlap removal**: Filters smaller boxes inside larger ones (truck+trailer, car carriers)

**Output**: `result.json` with final count, per-class breakdown, and evidence frame hashes.

**WebSocket protocol** (port 8765):

```json
// Init message (on connect)
{"type": "init", "stream": "...", "duration": 300, "count": 0, "marketAddress": "0x..."}

// Count update (~1/sec)
{"type": "count", "count": 42, "elapsed": 45.2, "remaining": 254.8}

// Binary JPEG frame (sent after each count message)

// Round complete
{"type": "final", "count": 42, "duration": 300}
```

#### watchdog.py (Process Supervisor)

Enterprise-grade process management:

- **Lock file**: Prevents duplicate instances (`/tmp/rush_oracle.lock`)
- **Health monitoring**: Heartbeat every 30 seconds
- **Crash recovery**: Exponential backoff (5s -> 10s -> 30s -> 60s cap)
- **Rapid restart detection**: Alerts if 3+ restarts in 10 minutes
- **Webhook alerts**: Discord/Telegram notifications on crashes
- **Orphan cleanup**: Cancels stuck markets on every startup

#### signer.py (Cryptographic Attestation)

Commit-reveal scheme for oracle honesty:

1. **Commit**: `keccak256(abi.encodePacked(count, random_salt))` submitted before reveal
2. **Reveal**: Oracle discloses count + salt; contract verifies hash matches
3. **Evidence**: SHA-256 hashes of detection frames for auditability

This prevents oracles from copying each other's counts in a multi-oracle setup.

### Evidence Collection

Every round generates cryptographic evidence:

- **Annotated frames**: Saved every 30 seconds + final frame
- **Format**: JPEG at quality 80, stored in `oracle/evidence/`
- **Hashes**: SHA-256 of each frame recorded in `result.json`
- **Retention**: Last 100 evidence sets (auto-cleanup)
- **Purpose**: Enables post-resolution verification and dispute resolution

---

## Cameras

Currently supported camera feeds:

| ID | Name | Region | Type |
|----|------|--------|------|
| `peace-bridge-qew` | Peace Bridge QEW | Fort Erie, ON, Canada | YouTube Live |
| `netherlands-highway` | Netherlands Highway | Netherlands, EU | YouTube Live |
| `caltrans-100` to `caltrans-220` | LA Freeway Cameras | Los Angeles, CA | HLS |
| `der-sp008-km095` etc. | Sao Paulo Highways | Sao Paulo, BR | JPEG Polling |

**Active rotation**: Peace Bridge and Netherlands Highway alternate each round.

**Stream types supported:**
- **YouTube Live**: Extracted via yt-dlp, processed through ffmpeg
- **HLS/m3u8**: Direct OpenCV stream from Caltrans-style endpoints
- **JPEG Polling**: Periodic refresh for DER-SP style static cameras

---

## Frontend

### Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Chain interaction**: wagmi v2 + viem (with `parseAbi()` -- critical for v2 compatibility)
- **Real-time**: Ably for market events, WebSocket for live vehicle count
- **Styling**: Tailwind CSS

### Pages

| Route | Description |
|-------|-------------|
| `/` | Main game -- live video, betting panel, countdown, chat, history |
| `/tiles` | 10x10 Socios grid -- claim, buyout, manage tiles |
| `/stats` | Platform analytics -- volume, markets resolved, fees |
| `/profile/[address]` | User betting history, winnings, tile portfolio |

### Real-Time Data Flow

```
                Ably (rush:market)
                  market_created ─────> invalidate React Query ─> re-render
                  market_resolved ────> show results
                  market_cancelled ───> show refund

                WebSocket (8765)
                  count updates ──────> live vehicle counter
                  binary frames ──────> video player

                wagmi events
                  BetPlaced ──────────> toast notification + pool update
                  MarketResolved ─────> claim section appears

                Polling (fallback)
                  5s: state, pools, bettors
                  15s: active markets, tiles
```

### Key Hooks

| Hook | Purpose |
|------|---------|
| `useActiveMarket()` | Polls factory for current OPEN/LOCKED market |
| `useMarketContract(addr)` | Reads all market data, watches events |
| `useMarketStream()` | Subscribes to Ably market events |
| `usePlaceBet(addr)` | Executes `placeBet()` transaction |
| `useClaimWinnings(addr)` | Claims resolved winnings |
| `useTilesContract()` | Full tile CRUD + fee claiming |

### API Routes

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/ably-token` | POST | Generates short-lived Ably tokens (keeps API key server-side) |
| `/api/ledger` | POST | Oracle posts market records (API key auth) |
| `/api/ledger` | GET | Paginated market history |
| `/api/rounds/history` | GET | Last 100 resolved rounds |
| `/api/stats` | GET | Platform-wide statistics |
| `/api/profile/[address]` | GET | User betting history and stats |
| `/api/evidence/[market]` | GET | YOLO detection frames for a resolved market |
| `/api/health` | GET | Health check |

---

## Security

### Smart Contract Security

- **155 unit tests** (Foundry) -- all passing
- **Slither audit** -- zero critical vulnerabilities
- **ReentrancyGuard** (OpenZeppelin) on all payable functions
- **Checks-effects-interactions** pattern enforced throughout
- **Safe transfers** for batch operations (individual failures don't revert the batch)
- **Verified source code** on Basescan

### Oracle Security

- **Commit-reveal scheme** prevents oracle collusion (DataAttestation.sol)
- **Multi-oracle consensus** with median + tolerance (ConsensusEngine.sol)
- **Oracle staking** with slashing for dishonesty (OracleRegistry.sol)
- **Dispute mechanism** with challenger deposits (DisputeManager.sol)
- **Cryptographic evidence** -- SHA-256 frame hashes for verification

### Frontend Security

- No private keys in browser (wagmi wallet abstraction)
- Server-side Ably token generation (API key never exposed)
- API key authentication on ledger writes
- Rate limiting on all endpoints

---

## Revenue Model

### Protocol Fee

Every resolved market collects a **flat 5% fee** from the total pool.

```
Total Pool: 10 ETH
  -> Protocol Fee (5%):  0.5 ETH -> Treasury
  -> Distributable (95%): 9.5 ETH -> Winners (proportional to bet size)
```

### Fee Distribution to Socios

The treasury balance is distributed to tile holders via the RushTiles contract. See [SOCIOS.md](./SOCIOS.md) for full details on tile economics.

### Revenue Sources Summary

| Source | Rate | Destination |
|--------|------|-------------|
| Market betting fee | 5% of pool | Treasury -> Tile holders |
| Harberger tax on tiles | 5%/week of declared price | 50% dev, 50% tile holders |
| Tile buyout fee | 10% of effective price | 60% dev, 40% tile holders |
| Tile appreciation tax | 30% of price increase | 60% dev, 40% tile holders |
| Tile claim fee (2nd+ tile) | 10% of declared price | 60% dev, 40% tile holders |

---

## Future Roadmap

### New Market Types

The architecture supports any observable outcome. Planned additions:

- **BTC 5min**: Will the price of Bitcoin go up or down in the next 5 minutes?
- **ETH 1min**: Ultra-short-term Ethereum price prediction
- **Custom durations**: 1min, 5min, 15min, 1hr markets
- **Multi-range**: Instead of just Under/Over, support 3+ ranges (e.g., "Down >1%", "Flat", "Up >1%")

### Commission Distribution to Socios

Tile holders will receive direct commission payouts from all market types:
- Current: Vehicle counting markets
- Upcoming: Crypto price prediction markets
- Each new market type adds to the fee pool distributed to tile holders
- More markets = more volume = more commissions per tile

### Additional Planned Features

- **Token mode**: USDC betting (infrastructure ready in contracts)
- **Multiple oracles**: Consensus voting on outcomes
- **Mobile app**: Native iOS/Android
- **Flaunch integration**: $RUSH token with tile holder benefits
- **Expanded camera network**: More cities, more feeds
- **Dispute mechanism activation**: Currently placeholder, will enable community challenges

---

## Development

### Smart Contracts

```bash
cd contracts
forge install          # Install OpenZeppelin + forge-std
forge build            # Compile
forge test             # Run 155 tests
forge coverage         # Code coverage
```

### Frontend

```bash
cd frontend
npm install
npm run dev            # localhost:3000
npm run build && npm start
```

### Oracle

```bash
cd oracle
pip install -r requirements.txt
python3 watchdog.py                          # Production (supervised)
python3 round_manager_rush.py                # Direct (infinite)
python3 round_manager_rush.py --rounds 3     # Test mode
```

### Environment Variables

**Oracle (.env):**
```
PRIVATE_KEY=<oracle wallet private key>
RPC_URL=<Base mainnet RPC>
FACTORY_ADDRESS=0x5b04F3DFaE780A7e109066E754d27f491Af55Af9
ROUND_DURATION=300
BETTING_WINDOW=150
WS_PORT=8765
ABLY_API_KEY=<key>
LEDGER_URL=https://www.rushgame.vip/api/ledger
LEDGER_API_KEY=<key>
ALERT_WEBHOOK_URL=<Discord/Telegram webhook>
```

**Frontend (.env.local):**
```
NEXT_PUBLIC_RPC_URL=<Base RPC>
NEXT_PUBLIC_WSS_URL=<Base WSS>
NEXT_PUBLIC_ABLY_API_KEY=<public key>
ABLY_API_KEY=<server-side key>
```
