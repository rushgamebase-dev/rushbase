# Rush Socios -- Tile Ownership & Revenue Sharing

## Overview

Rush Socios is a **Harberger tax economy** built into the Rush prediction market. It consists of a 10x10 grid of **100 tiles**, each representing 1 share of the protocol's revenue. Tile holders earn proportional commissions from every market that resolves on the platform.

**Contract:** `0x6cE3873e31Ab5440fA6AF1860F8E36110504c9C4` (Base Mainnet, verified on Basescan)

**Core Principle:** Tiles are a revenue-sharing mechanism, not collectibles. The Harberger tax model ensures tiles flow to those who value them most, while generating continuous revenue for all holders.

---

## How Tiles Work

### The Harberger Tax Model

Harberger taxation combines two rules:
1. **Self-assessment**: You declare the price of your tile. This is the price at which anyone can buy it from you.
2. **Periodic tax**: You pay a tax proportional to your declared price. Higher price = higher tax, but harder to buy out.

This creates a natural tension: set the price too low and someone buys you out; set it too high and the tax drains your deposit. The optimal strategy is to price your tile at your honest valuation.

### Tile Constants

| Parameter | Value | Description |
|-----------|-------|-------------|
| Grid Size | 100 tiles (10x10) | Total supply, fixed forever |
| Max Per Wallet | 5 tiles | Prevents monopolization |
| Min Price | 0.01 ETH | Floor price for any tile |
| Tax Rate | 5% per week | Continuous tax on declared price |
| Tax Period | 1 week (604,800 sec) | Tax accrues every second |
| Buyout Fee | 10% of effective price | Paid by buyer on forced acquisition |
| Appreciation Tax | 30% of price increase | Paid when raising your tile's price |
| Price Decay | 20% per 2-week period | Discourages passive holding at high prices |

---

## Tile Lifecycle

### 1. Claiming a Tile

Any unclaimed tile can be acquired:

```
claimTile(tileIndex, price)
```

**First tile**: Free claim fee. You only pay the tax deposit (minimum 1 week of tax at your declared price).

**2nd through 5th tile**: 10% claim fee on declared price, plus the tax deposit.

**What you pay:**
```
msg.value >= price * 5% (1 week tax deposit) + claimFee

Where claimFee:
  - 1st tile: 0
  - 2nd+ tile: price * 10%
```

**Example:** Claiming your first tile at 0.5 ETH price:
- Tax deposit: 0.5 * 5% = 0.025 ETH
- Claim fee: 0 (first tile)
- **Total: 0.025 ETH**

**Example:** Claiming your 3rd tile at 1 ETH price:
- Tax deposit: 1.0 * 5% = 0.05 ETH
- Claim fee: 1.0 * 10% = 0.1 ETH
- **Total: 0.15 ETH**

### 2. Owning a Tile

While you own a tile:

- **Tax accrues every second**: `tax = price * elapsed_seconds * 5% / (10,000 * 604,800)`
- Tax is deducted from your deposit automatically
- If your deposit runs out, your tile is **foreclosed** (you lose it + remaining deposit)
- You can top up your deposit anytime with `addDeposit(tileIndex)`
- You can withdraw excess deposit with `withdrawDeposit(tileIndex, amount)`
- You earn **commission** from every resolved market (proportional to tile count)

### 3. Changing Your Price

You can reprice your tile at any time:

```
setPrice(tileIndex, newPrice)
```

**Lowering price**: Free. Reduces your future tax obligation.

**Raising price**: Triggers a 30% appreciation tax on the difference.

**Example:** Raising from 0.5 ETH to 1.0 ETH:
- Price increase: 0.5 ETH
- Appreciation tax: 0.5 * 30% = 0.15 ETH (paid from deposit or msg.value)

**Max increase**: 3x the current effective price per transaction.

### 4. Buyout (Forced Acquisition)

Anyone can buy your tile at any time by paying the effective price plus fees:

```
buyoutTile(tileIndex, newPrice)
```

**What the buyer pays:**
```
Effective Price (EP)         -> Goes to the seller
+ Buyout Fee (10% of EP)    -> Split: 40% treasury, 60% dev
+ Appreciation Tax           -> If newPrice > EP: 30% of (newPrice - EP)
+ New Tax Deposit            -> At least 1 week of tax on newPrice
```

**What the seller receives:**
```
Effective Price + Remaining Deposit
```

The seller always gets the full effective price of their tile plus whatever deposit they had left. This is the "insurance" that makes the Harberger model fair -- you're compensated at the price you chose.

**Example:**

Tile priced at 0.5 ETH, effective price after decay = 0.45 ETH, seller has 0.1 ETH deposit.

Buyer wants to set new price at 0.8 ETH:
- Effective price: 0.45 ETH -> seller
- Buyout fee: 0.045 ETH -> 40% treasury (0.018), 60% dev (0.027)
- Appreciation tax: (0.8 - 0.45) * 30% = 0.105 ETH -> 40% treasury, 60% dev
- New deposit: 0.8 * 5% = 0.04 ETH minimum
- **Buyer total: ~0.64 ETH**
- **Seller receives: 0.45 + 0.1 = 0.55 ETH**

### 5. Price Decay

To prevent speculation (claiming at a high price and sitting on it indefinitely), tile prices decay over time:

- **Rate**: 20% per 2-week period after the last buyout
- **Floor**: Price never drops below 10% of the original declared price
- **Effect**: Makes buyouts cheaper over time, encouraging active participation

```
effective_price = declared_price * (1 - 0.20)^(weeks_since_buyout / 2)
```

**Example:** Tile priced at 1 ETH, 4 weeks since last buyout:
- Decay periods: 4 / 2 = 2
- Effective price: 1.0 * (0.80)^2 = 0.64 ETH

### 6. Abandoning a Tile

You can voluntarily give up a tile:

```
abandonTile(tileIndex)
```

- Your remaining deposit is returned to you
- The tile becomes unclaimed and available for anyone
- Your tile count decreases (opening a slot for a new tile)

### 7. Foreclosure

If your deposit runs out (tax > deposit), anyone can trigger foreclosure:

```
pokeTax(tileIndex)
```

- The tile is seized and becomes unclaimed
- **You lose your remaining deposit** (it's consumed by tax)
- This is the penalty for not maintaining your deposit

**Prevention**: Monitor your deposit and top up with `addDeposit()` before it runs out. The frontend shows deposit health and warnings.

---

## Commission System

### How Tile Holders Earn

Every tile represents **1 share** out of 100 in the protocol's revenue pool. When markets resolve and fees are collected, tile holders earn proportional commissions.

**The accumulator pattern:**

The contract uses a gas-efficient global accumulator (`globalRewardPerShare`) instead of iterating over all holders:

```
1. Fees arrive in treasury (from market resolution, tile taxes, buyouts)
2. distributeFees() is called:
   globalRewardPerShare += treasuryBalance / totalActiveTiles
3. For each tile holder:
   pending = (globalRewardPerShare - player.rewardSnapshot) * player.tileCount
4. Player calls claimFees() to withdraw pending amount
```

This means holding **more tiles = more commission**, linearly.

### Revenue Sources

Tile holders receive commissions from **all** of these sources:

#### From Prediction Markets (Current + Future)

| Source | Rate | To Tile Holders |
|--------|------|-----------------|
| Vehicle counting markets | 5% of pool | 100% of treasury share |
| BTC 5min markets *(upcoming)* | 5% of pool | 100% of treasury share |
| ETH 1min markets *(upcoming)* | 5% of pool | 100% of treasury share |
| All future market types | 5% of pool | 100% of treasury share |

Every new market type that launches on Rush **automatically** increases the commission pool for tile holders. More markets = more volume = more fees = more commissions.

#### From Tile Economy

| Source | Rate | Tile Holder Share |
|--------|------|-------------------|
| Harberger tax | 5%/week of price | 50% (other 50% to dev) |
| Buyout fees | 10% of effective price | 40% (other 60% to dev) |
| Appreciation tax | 30% of price increase | 40% (other 60% to dev) |
| Claim fees (2nd+ tile) | 10% of declared price | 40% (other 60% to dev) |

### Commission Example

**Scenario:** You own 2 tiles. There are 80 active tiles total. A market resolves with 10 ETH total pool.

```
Protocol fee: 10 ETH * 5% = 0.5 ETH -> treasury

distributeFees() called:
  globalRewardPerShare += 0.5 ETH / 80 tiles = 0.00625 ETH per tile

Your pending commission:
  0.00625 * 2 tiles = 0.0125 ETH

You call claimFees() -> receive 0.0125 ETH
```

**Monthly projection** (hypothetical, 200 markets/month, avg 5 ETH pool):

```
Monthly volume: 200 * 5 = 1,000 ETH
Monthly fees: 1,000 * 5% = 50 ETH to treasury
Per tile (if 80 active): 50 / 80 = 0.625 ETH/month
For 2 tiles: 1.25 ETH/month
```

### Future Commission Growth

As Rush adds new market types, tile holder commissions grow proportionally:

```
Current:
  Vehicle counting -> X ETH/month in fees

After BTC 5min launch:
  Vehicle counting -> X ETH/month
  BTC 5min         -> Y ETH/month
  Total            -> (X + Y) ETH/month

After ETH 1min launch:
  Vehicle counting -> X ETH/month
  BTC 5min         -> Y ETH/month
  ETH 1min         -> Z ETH/month
  Total            -> (X + Y + Z) ETH/month
```

Each new market is an **additional revenue stream** for the same 100 tiles. The supply of tiles is fixed -- only demand and volume grow.

---

## Fee Distribution Flow

```
                    PREDICTION MARKET RESOLVES
                              |
                    5% fee collected (0.5 ETH on 10 ETH pool)
                              |
                              v
                    +-------------------+
                    |   Fee Recipient   |
                    |   (Treasury)      |
                    +-------------------+
                              |
                    distributeFees()
                              |
                    +-------------------+
                    |  globalRewardPer  |
                    |  Share increases  |
                    +-------------------+
                         /    |    \
                        /     |     \
                   Tile 0  Tile 1  ... Tile 99
                   Owner A Owner B     Owner N
                      |       |           |
                  claimFees() each holder calls when ready
                      |       |           |
                   0.005 ETH 0.005 ETH  0.005 ETH
                   (1 tile)  (1 tile)   (1 tile)


              TILE ECONOMY FEES (taxes, buyouts, etc.)
                              |
                    Split: treasury + dev
                              |
                    +-------------------+
                    | Treasury (40-50%) |-----> Same distribution as above
                    +-------------------+
                    | Dev (50-60%)      |-----> Dev wallet
                    +-------------------+
```

---

## Strategy Guide

### For New Users

1. **Claim your first tile** -- it's free (just the deposit). Choose a price you're comfortable defending.
2. **Set a fair price** -- too low and you'll be bought out; too high and tax eats your deposit.
3. **Monitor your deposit** -- if it runs out, you lose the tile AND the remaining deposit.
4. **Claim commissions regularly** -- fees accumulate, but you must call `claimFees()` to withdraw.

### Pricing Strategy

| Strategy | Price Level | Risk | Reward |
|----------|-------------|------|--------|
| **Passive holder** | Low (0.01-0.05 ETH) | High buyout risk | Low tax, cheap to maintain |
| **Active holder** | Medium (0.1-0.5 ETH) | Balanced | Moderate tax, decent protection |
| **Defender** | High (0.5-2 ETH) | Low buyout risk | High tax, expensive to maintain |

**Optimal**: Price at what you'd genuinely be willing to sell for. The Harberger model is designed so that honest pricing is the dominant strategy.

### Maximizing Commissions

- **Own more tiles** (up to 5) -- commissions scale linearly with tile count
- **Stay active** -- maintain deposits to avoid foreclosure
- **Claim regularly** -- accumulated fees sit in the contract until you withdraw
- **Watch for opportunities** -- foreclosed tiles are free to claim

### Tile Investment Math

To evaluate if a tile is worth holding:

```
Annual tax cost = declared_price * 5% * 52 weeks = declared_price * 2.6

Break-even: annual_commissions >= annual_tax_cost

If total annual volume = V ETH, and there are T active tiles:
  annual_commission_per_tile = V * 5% / T

Break-even price = annual_commission_per_tile / 2.6
```

**Example:** If annual volume is 10,000 ETH and 80 tiles are active:
- Annual commission per tile: 10,000 * 5% / 80 = 6.25 ETH
- Break-even price: 6.25 / 2.6 = **2.4 ETH**
- Any price below 2.4 ETH is profitable to hold

---

## Technical Details

### Data Structures

```solidity
struct TileData {
    address owner;           // Current tile owner (address(0) if unclaimed)
    uint80 price;            // Self-assessed price in wei
    uint96 deposit;          // Tax payment deposit in wei
    uint40 lastTaxTime;      // Last time tax was collected
    uint40 lastBuyoutTime;   // Last ownership change (for decay calculation)
}

struct PlayerState {
    uint128 rewardSnapshot;  // Global accumulator snapshot at last update
    uint96 accumulatedFees;  // Unclaimed accumulated commissions
    uint8 tileCount;         // Number of tiles owned (0-5)
    uint8[5] tilesOwned;     // Array of tile indices owned
}
```

### Contract Functions

#### Tile Management

| Function | Who Can Call | Description |
|----------|-------------|-------------|
| `claimTile(tileIndex, price)` | Anyone | Claim an unclaimed tile |
| `buyoutTile(tileIndex, newPrice)` | Anyone | Force-buy a claimed tile |
| `abandonTile(tileIndex)` | Tile owner | Give up tile, recover deposit |
| `setPrice(tileIndex, newPrice)` | Tile owner | Change self-assessed price |
| `addDeposit(tileIndex)` | Tile owner | Top up tax deposit |
| `withdrawDeposit(tileIndex, amount)` | Tile owner | Withdraw excess deposit |
| `pokeTax(tileIndex)` | Anyone | Trigger tax collection (can foreclose) |

#### Commission Management

| Function | Who Can Call | Description |
|----------|-------------|-------------|
| `distributeFees()` | Anyone | Distribute treasury to all holders |
| `claimFees()` | Tile holder | Withdraw accumulated commissions |
| `claimDevFees()` | Dev wallet | Withdraw dev share |
| `pendingFees(player)` | View | Check unclaimed commission amount |

#### Views

| Function | Returns |
|----------|---------|
| `getTile(tileIndex)` | TileData for a specific tile |
| `getAllTiles()` | Array of all 100 TileData structs |
| `getPlayer(address)` | PlayerState for a wallet |
| `effectivePrice(tileIndex)` | Price after decay |
| `treasuryBalance()` | Current undistributed fees |
| `totalActiveTiles()` | Number of claimed tiles |

### Events

```solidity
event TileClaimed(uint256 tileIndex, address owner, uint256 price, uint256 deposit);
event TileBuyout(uint256 tileIndex, address newOwner, address prevOwner,
                 uint256 effectivePrice, uint256 newPrice, uint256 buyoutFee,
                 uint256 appreciationTax);
event TileAbandoned(uint256 tileIndex, address owner, uint256 depositReturned);
event PriceChanged(uint256 tileIndex, uint256 oldPrice, uint256 newPrice,
                   uint256 appreciationTax);
event TaxCollected(uint256 tileIndex, uint256 taxAmount, uint256 devCut);
event TileForeclosed(uint256 tileIndex, address prevOwner);
event FeesDistributed(uint256 amount);
event FeesClaimed(address player, uint256 amount);
event DevFeesClaimed(address devWallet, uint256 amount);
```

### Safety Features

- **ReentrancyGuard**: All state-changing functions protected
- **Pause mechanism**: Authority can pause all operations in emergencies
- **Emergency withdraw**: After 90 days of inactivity, authority can recover stuck funds
- **Max tiles per wallet**: 5 (prevents monopolization)
- **Min price floor**: 0.01 ETH (prevents zero-price griefing)
- **Max price increase**: 3x effective price per transaction

---

## FAQ

**Q: What happens if all tiles are claimed?**
A: You must buy one from an existing holder via `buyoutTile()`. The Harberger model ensures tiles are always available at a price.

**Q: Can I lose money holding a tile?**
A: Yes. If your commissions don't cover your tax, you're losing money. Lower your price to reduce tax, or abandon the tile.

**Q: What happens to my commissions if I get bought out?**
A: Accumulated commissions are preserved. You can still call `claimFees()` after losing your tile. However, you stop earning new commissions.

**Q: How often should I claim commissions?**
A: Whenever you want. There's no deadline -- commissions accumulate indefinitely. But gas costs apply to each claim, so batching is more efficient.

**Q: What happens if nobody calls `distributeFees()`?**
A: Fees accumulate in the treasury. Anyone can call `distributeFees()` -- it's a public function. The frontend triggers it periodically. Direct ETH received by the contract (e.g., from `receive()`) is distributed automatically.

**Q: Will new market types (BTC 5min, etc.) require a new contract?**
A: No. All market types use the same MarketFactory, which sends fees to the same treasury, which distributes to the same tile holders. New markets are additive -- they increase the fee pool without any contract changes.

**Q: Can the dev change the fee split?**
A: The authority can update configuration parameters, but key constraints (100 tiles, 5 max per wallet, fee caps) are hardcoded and immutable.
