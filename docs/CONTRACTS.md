# Rush Protocol — Smart Contract Reference

Comprehensive reference for the Rush prediction market protocol deployed on Base mainnet. Rush is a pari-mutuel prediction market where users bet on real-world outcomes (vehicle counts from live cameras). The protocol operates with zero house edge — fees go to tile holders or are burned.

---

## Deployed Addresses (Base Mainnet)

| Contract | Address | Status |
|----------|---------|--------|
| BurnMarketFactory | `0xf3edae04f632bc4cfde9a08e06f36a17bfaee83f` | Production |
| $RUSH Token | `0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b` | Production |
| RushTiles V1 (Series 1) | `0x6cE3873e31Ab5440fA6AF1860F8E36110504c9C4` | Production |
| RushTiles V2 (Series 2) | `0x5b7b2a6AC4f3A017fb943C9F550d609174532fFF` | Production |
| MarketFactory (ETH) | `0x5b04F3DFaE780A7e109066E754d27f491Af55Af9` | Legacy |
| Oracle/Admin | `0x4c385830c2E241EfeEd070Eb92606B6AedeDA277` | — |
| Fee Recipient | `0xdd12D83786C2BAc7be3D59869834C23E91449A2D` | — |

### Previous Deploys (Deprecated)

| Version | Address |
|---------|---------|
| V3 | `0x96A43C28e1f102f5A8acE3d1b7c151b87f6BB41E` |
| V2 | `0x80E6c49C6A694a259A4cC7fB9ABa97A876Ffc9fC` |
| V1 | `0x7b51C8C92f24Ef705E9C5c6f77ffA819b9733f4c` |

---

## Contract Details

### 1. BurnMarketFactory (~130 lines)

Factory contract for $RUSH token prediction markets. Creates BurnMarket instances for each round.

**Key Functions:**

| Function | Access | Description |
|----------|--------|-------------|
| `createMarket(description, ranges, roundDurationSecs)` | Oracle/Admin | Deploys a new BurnMarket instance |
| `setAdmin(address)` | Admin | Transfer admin role |
| `setOracle(address)` | Admin | Set oracle address |
| `getMarketCount()` | Public | Total markets created |
| `getMarkets(offset, limit)` | Public | Paginated market list |
| `getActiveMarkets()` | Public | All non-resolved/cancelled markets |

**Configuration:**
- `feeBps = 0` — compatibility stub, no factory-level fee
- `feeRecipient = address(0)` — compatibility stub

**Events:**
```
MarketCreated(uint256 marketIndex, address marketAddress, string description, uint256 roundDurationSecs, bool isTokenMode)
```

---

### 2. BurnMarket (~300 lines)

Prediction market with a 70/30 burn split. All bets denominated in $RUSH token (ERC20).

**Constants:**
- `BURN_BPS = 3000` (30%)
- `BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD`

**Lifecycle:**
```
OPEN → LOCKED → RESOLVED
                 ↘ CANCELLED
```

**Key Functions:**

| Function | Access | Description |
|----------|--------|-------------|
| `placeBetToken(rangeIndex, amount)` | Public | Place bet (requires prior `approve()` on $RUSH) |
| `lockMarket()` | Oracle | Stop accepting bets |
| `resolveMarket(actualCarCount)` | Oracle | Find winning range, execute burn, mark resolved |
| `cancelMarket()` | Oracle | Cancel and enable refunds |
| `distributeAll()` | Public | Auto-pay all winners |
| `refundAll()` | Public | Auto-refund all bettors (after cancel) |

**Payout Formula:**
```
totalBurned  = totalPool * BURN_BPS / 10000      (30% burned to 0xdead)
prizePool    = totalPool - totalBurned            (70% to winners)
userPayout   = (userBet / winningRangePool) * prizePool
```

**Flow:** `resolveMarket()` determines the winning range, transfers 30% of the total pool to `0x...dEaD` (permanent burn), and the remaining 70% is distributed proportionally among winners via `distributeAll()`.

---

### 3. MarketFactory (~200 lines) — Legacy

Factory contract for ETH-denominated prediction markets. Creates PredictionMarket instances.

**Configuration:**
- `feeBps = 500` (5%)
- `feeRecipient = 0xdd12D83786C2BAc7be3D59869834C23E91449A2D`

**Key Functions:**

Same `createMarket()` interface as BurnMarketFactory. Markets are created per-round by the oracle.

---

### 4. PredictionMarket (~500 lines) — Legacy

ETH pari-mutuel betting pool. 5% fee directed to tile holders via the fee recipient.

**Lifecycle:**
```
OPEN → LOCKED → RESOLVED
                 ↘ CANCELLED
```

**Key Functions:**

| Function | Access | Description |
|----------|--------|-------------|
| `placeBet(rangeIndex)` | Public (payable) | Place ETH bet during OPEN |
| `lockMarket()` | Oracle | Stop accepting bets |
| `resolveMarket(actualCount)` | Oracle | Find winning range, collect fee, mark resolved |
| `cancelMarket()` | Oracle | Cancel and enable refunds |
| `distributeAll()` | Public | Auto-pay all winners |
| `refundAll()` | Public | Auto-refund all bettors (after cancel) |
| `claimWinningsFor(address)` | Public | Per-user payout with safe transfer |
| `refundFor(address)` | Public | Per-user refund with safe transfer |

**Payout Formula:**
```
feeCollected = totalPool * feeBps / 10000         (5% protocol fee)
prizePool    = totalPool - feeCollected            (95% to winners)
userPayout   = (userBet / winningRangePool) * prizePool
```

**Tracking:**
- `bettorList[]` + `hasBet[]` — tracks all unique bettors for batch operations
- `lockTime` — immutable, set once in constructor

---

### 5. RushTiles V1 — Series 1 (~700 lines)

100 tiles (10x10 grid), 1 share each, max 5 tiles per wallet. Harberger-taxed ownership with revenue distribution.

**Tile Mechanics:**
- First tile: FREE claim (deposit >= 5% of self-assessed price)
- Subsequent tiles: 10% claim fee
- Price decay: 20% per 2 weeks (floor at 10% of original)
- Max price increase: 3x per operation
- Distribution: `globalRewardPerShare` accumulator pattern

**Fee Schedule:**

| Fee Type | Rate | Dev Share | Holder Share |
|----------|------|-----------|--------------|
| Harberger tax | 5%/week | 50% | 50% |
| Buyout fee | 10% | 60% | 40% |
| Appreciation tax | 30% | 60% | 40% |
| Claim fee | 10% | 60% | 40% |

**Integrations:**
- **Flaunch:** `receive()` distributes incoming ETH to holders. `claimFlaunchFees(feeEscrow)` pulls fees from Flaunch escrow.
- **MemeStream:** ERC721 receiver for NFT integration.

**Emergency:** 90-day timelock for emergency withdraw.

---

### 6. RushTiles V2 — Series 2 (~590 lines)

100 tiles with a two-tier system. Designed to incentivize early commitment with founder-tier protections.

**Tier System:**

| Tier | Min Price | Shares/Tile | Buyout |
|------|-----------|-------------|--------|
| Founder | 0.5 ETH | 5 | CANNOT be bought out |
| Normal | 0.1 ETH | 1 | Can be bought out |

**Fee Schedule:**

| Fee Type | Rate | Dev Share | Holder Share |
|----------|------|-----------|--------------|
| Harberger tax | 5%/week | 70% | 30% |
| Buyout fee | 10% | 100% | 0% |
| Appreciation tax | 30% | 100% | 0% |
| Claim fee | 10% | 100% | 0% |
| External ETH (receive) | — | 0% | 100% |

**Emergency:** 30-day timelock for emergency withdraw.

---

### 7. Dormant Contracts

These contracts are deployed and verified on Basescan but not enforced in production. They provide infrastructure for a future multi-oracle setup.

**OracleRegistry (~250 lines)**
Oracle staking, registration, and slashing framework. Oracles would stake to participate and risk slashing for misbehavior. Currently not enforced — single trusted oracle in production.

**DataAttestation (~250 lines)**
Commit-reveal scheme for oracle data integrity. Oracle commits hash of data before revealing actual values. Currently deployed with `disputeWindowSecs = 0` (effectively disabled).

**ConsensusEngine (~300 lines)**
Multi-oracle median consensus mechanism. Requires quorum (66.67%) with tolerance (+-2 count). Designed for multiple independent oracles to agree on vehicle counts. Single oracle in production renders this unused.

**DisputeManager (~350 lines)**
Post-resolution dispute mechanism. Challengers deposit funds to dispute a market result, triggering review. Not active — `disputeWindowSecs = 0` means disputes cannot be filed.

---

## Fee Flow Diagrams

### $RUSH Token Market Flow
```
                    placeBetToken()
  Bettors ──────────────────────────► BurnMarket
                                          │
                              resolveMarket(count)
                                          │
                          ┌───────────────┼───────────────┐
                          │               │               │
                          ▼               ▼               ▼
                     Winners (70%)   0xdead (30%)    [if cancel]
                     distributeAll()  permanent       refundAll()
                     proportional     burn            full refund
                     to bet size
```

### ETH Market Flow (Legacy)
```
                      placeBet()
  Bettors ──────────────────────────► PredictionMarket
                                          │
                              resolveMarket(count)
                                          │
                          ┌───────────────┼───────────────┐
                          │               │               │
                          ▼               ▼               ▼
                     Winners (95%)   Fee (5%)         [if cancel]
                     distributeAll()     │             refundAll()
                     proportional        ▼             full refund
                     to bet size    Fee Recipient
                                   (0xdd12...9A2D)
                                         │
                                         ▼
                                    RushTiles
                                    treasury
                                         │
                                         ▼
                                    Tile holders
                                    (per share)
```

### Tile Economy Flow
```
  ┌─────────────────────────────────────────────────────────┐
  │                    RushTiles Contract                     │
  │                                                          │
  │   Harberger Tax (5%/week)                                │
  │       │                                                  │
  │       ├──► Dev wallet    (V1: 50% / V2: 70%)            │
  │       └──► Holders       (V1: 50% / V2: 30%)            │
  │                                                          │
  │   Buyout Fee (10%)                                       │
  │       ├──► Dev wallet    (V1: 60% / V2: 100%)           │
  │       └──► Holders       (V1: 40% / V2: 0%)             │
  │                                                          │
  │   Appreciation Tax (30%)                                 │
  │       ├──► Dev wallet    (V1: 60% / V2: 100%)           │
  │       └──► Holders       (V1: 40% / V2: 0%)             │
  │                                                          │
  │   Claim Fee (10%)                                        │
  │       ├──► Dev wallet    (V1: 60% / V2: 100%)           │
  │       └──► Holders       (V1: 40% / V2: 0%)             │
  │                                                          │
  │   External ETH (receive)                                 │
  │       └──► Holders       (V1: 100% / V2: 100%)          │
  └─────────────────────────────────────────────────────────┘
```

---

## V1 vs V2 Fee Comparison

| Fee Type | V1 Holders | V1 Dev | V2 Holders | V2 Dev |
|----------|-----------|--------|-----------|--------|
| Harberger tax (5%/week) | 50% | 50% | 30% | 70% |
| Buyout fee (10%) | 40% | 60% | 0% | 100% |
| Appreciation tax (30%) | 40% | 60% | 0% | 100% |
| Claim fee (10%) | 40% | 60% | 0% | 100% |
| External ETH (receive) | 100% | 0% | 100% | 0% |

**Key differences:**
- V2 shifts nearly all transactional fees to dev, keeping only Harberger tax and external ETH for holders.
- V2 introduces Founder tier (5 shares, no buyout) to reward early commitment.
- V2 reduces emergency timelock from 90 days to 30 days.

---

## Security

All production contracts share the following security properties:

- **ReentrancyGuard** — All state-modifying functions protected against reentrancy attacks.
- **Checks-Effects-Interactions** — State updates before external calls throughout.
- **Safe Transfers** — ETH transfers use low-level call with success checks; ERC20 uses SafeERC20.
- **Access Control** — Oracle-only functions for market lifecycle operations (lock, resolve, cancel).
- **Verified on Basescan** — All contracts are verified and source-readable on Base block explorer.
- **Emergency Timelocks** — Emergency withdraw functions gated by timelocks (90 days V1, 30 days V2) to prevent rug scenarios.
- **Immutable Lock Times** — `lockTime` set once in constructor, cannot be overwritten to manipulate betting windows.
- **Pool Validation** — Oracle cancels markets with no bets or one-sided pools, protecting bettors from unfair outcomes.
