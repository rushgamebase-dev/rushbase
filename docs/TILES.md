# RushTiles -- Revenue Sharing Tiles

## Overview

RushTiles is a **Harberger tax economy** built into the Rush prediction market on Base. There are two independent tile series -- **Series 1 (V1)** and **Series 2 (V2)** -- each consisting of a 10x10 grid of **100 tiles**.

**Core Principle:** Tiles are a revenue-sharing mechanism, not collectibles. The Harberger tax model ensures tiles flow to those who value them most, while generating continuous revenue for all holders.

**Harberger taxation** combines two rules:
1. **Self-assessment**: You declare the price of your tile. This is the price at which anyone can buy it from you.
2. **Periodic tax**: You pay a tax proportional to your declared price. Higher price = higher tax, but harder to buy out.

This creates a natural tension: set the price too low and someone buys you out; set it too high and the tax drains your deposit. The optimal strategy is to price your tile at your honest valuation.

---

## Contracts

| Series | Contract Address | Chain |
|--------|-----------------|-------|
| Series 1 (V1) | `0x6cE3873e31Ab5440fA6AF1860F8E36110504c9C4` | Base Mainnet |
| Series 2 (V2) | `0x5b7b2a6AC4f3A017fb943C9F550d609174532fFF` | Base Mainnet |

Both contracts are verified on Basescan.

---

## Series 1 (V1) -- "Original 100"

100 tiles, 1 share per tile. The original tile economy.

### V1 Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| Grid Size | 100 tiles (10x10) | Total supply, fixed forever |
| Max Per Wallet | 5 tiles | Prevents monopolization |
| Shares Per Tile | 1 | Every tile is equal weight |
| Min Price | 0.01 ETH | Floor price for any tile |
| Tax Rate | 5% per week | Continuous tax on declared price |
| Tax Period | 1 week (604,800 sec) | Tax accrues every second |
| Buyout Fee | 10% of effective price | Paid by buyer on forced acquisition |
| Appreciation Tax | 30% of price increase | Paid when raising price or buying out above effective price |
| Claim Fee | 10% of declared price (2nd+ tile) | Free for first tile |
| Price Decay | 20% per 2-week period | Floor at 10% of original price |
| Max Price Increase | 3x per transaction | Prevents extreme price jumps |
| Emergency Timelock | 90 days | Before authority can emergency withdraw |

### V1 Fee Splits

| Fee Source | Holders | Dev |
|------------|---------|-----|
| Harberger tax (5%/week) | 50% | 50% |
| Buyout fee (10% of effective price) | 40% | 60% |
| Appreciation tax (30% of increase) | 40% | 60% |
| Claim fee (10%, 2nd+ tile) | 40% | 60% |
| Market fees (ETH prediction markets 5%) | 100% | 0% |
| Flaunch trading fees | 100% | 0% |
| Direct ETH via receive() | 100% | 0% |

### V1 Special Features

- **Flaunch integration**: V1 contract implements `IERC721Receiver` and can hold a MemeStream NFT from Flaunch. Trading fees from the Flaunch token are claimable via `claimFlaunchFees()` and distributed to tile holders.
- **Authority execute()**: Generic external call function for future integrations (cannot target the contract itself).
- **Max 5 tiles per wallet**: Hard limit enforced at contract level.

---

## Series 2 (V2) -- "Founder Edition"

100 tiles with **two tiers**: Founder and Normal. The key innovation is weighted shares -- Founder tiles earn 5x the commissions.

### V2 Tiers

| Property | Normal Tier | Founder Tier |
|----------|-------------|--------------|
| Tier Price (upfront) | 0.1 ETH | 0.5 ETH |
| Shares Per Tile | 1 | 5 |
| Commission Weight | 1x | 5x |
| Can Be Bought Out | Yes | **No** |

The tier price is paid upfront when claiming (on top of the tax deposit). It goes 100% to dev.

**Founder tiles cannot be bought out.** The `buyoutTile()` function reverts with `CannotBuyoutFounder()` if the target tile is a Founder tile. This creates a premium ownership tier: higher upfront cost, but permanent ownership (as long as you maintain your deposit) and 5x commission weight.

### V2 Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| Grid Size | 100 tiles (10x10) | Total supply, fixed forever |
| Max Per Wallet | No hard limit | Dynamic array tracking |
| Shares Per Tile | 1 (Normal) or 5 (Founder) | Determines commission weight |
| Min Price | 0.01 ETH | Floor for self-assessed price |
| Tax Rate | 5% per week | Same as V1 |
| Tax Period | 1 week (604,800 sec) | Same as V1 |
| Buyout Fee | 10% of effective price | Normal tiles only |
| Appreciation Tax | 30% of price increase | Same as V1 |
| Claim Fee | 10% of declared price (2nd+ tile) | Same as V1 |
| Price Decay | 20% per 2-week period | Same as V1 |
| Max Price Increase | 3x per transaction | Same as V1 |
| Emergency Timelock | 30 days | Shorter than V1 |

### V2 Fee Splits

| Fee Source | Holders | Dev |
|------------|---------|-----|
| Harberger tax (5%/week) | **30%** | **70%** |
| Buyout fee (10% of effective price) | **0%** | **100%** |
| Appreciation tax (30% of increase) | **0%** | **100%** |
| Claim fee (10%, 2nd+ tile) | **0%** | **100%** |
| Tier price (0.1 or 0.5 ETH upfront) | 0% | 100% |
| Direct ETH via receive() | **100%** | 0% |

V2 holder revenue comes from two sources only:
1. **30% of Harberger tax** collected from all tiles
2. **100% of external ETH** sent directly to the contract (e.g., market fees routed to the V2 contract)

All buyout fees, appreciation taxes, and claim fees go entirely to dev. This is a deliberate design choice -- V2 holders earn from the ongoing tax economy and external revenue, not from churn events.

---

## V1 vs V2 Comparison

| Feature | Series 1 (V1) | Series 2 (V2) |
|---------|---------------|----------------|
| Shares per tile | 1 | 1 (Normal) or 5 (Founder) |
| Min self-assessed price | 0.01 ETH | 0.01 ETH |
| Upfront tier price | None | 0.1 ETH (Normal) / 0.5 ETH (Founder) |
| Max tiles per wallet | 5 (hardcoded) | No hard limit |
| Buyout protection | None -- all tiles can be bought out | Founder tiles are immune |
| Tax -> Holders | 50% | 30% |
| Buyout fee -> Holders | 40% | 0% |
| Appreciation tax -> Holders | 40% | 0% |
| Claim fee -> Holders | 40% | 0% |
| External ETH -> Holders | 100% | 100% |
| Flaunch integration | Yes (`claimFlaunchFees`) | No |
| Emergency timelock | 90 days | 30 days |
| Accumulator divides by | `totalActiveTiles` | `totalShares` |
| Player tracking | Fixed `uint8[5]` array | Dynamic `uint8[]` array |

---

## Tile Lifecycle

The lifecycle is the same for both V1 and V2 unless noted.

### 1. Claiming a Tile

Any unclaimed tile can be acquired:

**V1:** `claimTile(tileIndex, price)`
**V2:** `claimTile(tileIndex, price, founder)`

The V2 `founder` boolean determines the tier. Once claimed, a tile's tier is fixed.

**First tile**: Free claim fee. You pay the tier price (V2 only) plus a tax deposit (minimum 1 week of tax at your declared price).

**2nd+ tile**: 10% claim fee on declared price, plus tier price (V2) and tax deposit.

**What you pay (V1):**
```
msg.value >= price * 5% (1 week tax deposit) + claimFee

Where claimFee:
  - 1st tile: 0
  - 2nd+ tile: price * 10%
```

**What you pay (V2):**
```
msg.value >= tierPrice + claimFee + minDeposit

Where:
  tierPrice:
    - Normal: 0.1 ETH
    - Founder: 0.5 ETH
  claimFee:
    - 1st tile: 0
    - 2nd+ tile: price * 10%
  minDeposit: price * 5% (1 week of tax)
```

**Example (V1):** Claiming your first tile at 0.5 ETH price:
- Tax deposit: 0.5 * 5% = 0.025 ETH
- Claim fee: 0 (first tile)
- **Total: 0.025 ETH**

**Example (V2 Founder):** Claiming your first Founder tile at 1 ETH price:
- Tier price: 0.5 ETH
- Tax deposit: 1.0 * 5% = 0.05 ETH
- Claim fee: 0 (first tile)
- **Total: 0.55 ETH**

**Example (V2 Normal):** Claiming your 2nd Normal tile at 0.5 ETH price:
- Tier price: 0.1 ETH
- Tax deposit: 0.5 * 5% = 0.025 ETH
- Claim fee: 0.5 * 10% = 0.05 ETH
- **Total: 0.175 ETH**

### 2. Owning a Tile

While you own a tile:

- **Tax accrues every second**: `tax = price * elapsed_seconds * 5% / (10,000 * 604,800)`
- Tax is deducted from your deposit automatically
- If your deposit runs out, your tile is **foreclosed** (you lose it + remaining deposit)
- You can top up your deposit anytime with `addDeposit(tileIndex)`
- You can withdraw excess deposit with `withdrawDeposit(tileIndex, amount)`
- You earn **commission** from protocol revenue (proportional to share count)

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

In V1 the appreciation tax is split 60% dev / 40% holders. In V2 it goes 100% to dev.

**Max increase**: 3x the current price per transaction (both series).

### 4. Buyout (Forced Acquisition)

Anyone can buy a tile at any time by paying the effective price plus fees:

```
buyoutTile(tileIndex, newPrice)
```

**V2 exception:** Founder tiles **cannot be bought out**. The transaction will revert with `CannotBuyoutFounder()`.

**What the buyer pays:**
```
Effective Price (EP)         -> Goes to the seller
+ Buyout Fee (10% of EP)    -> V1: 60% dev / 40% holders. V2: 100% dev
+ Appreciation Tax           -> If newPrice > EP: 30% of (newPrice - EP)
+ New Tax Deposit            -> At least 1 week of tax on newPrice
```

**What the seller receives:**
```
Effective Price + Remaining Deposit
```

The seller always gets the full effective price of their tile plus whatever deposit they had left. This is the "insurance" that makes the Harberger model fair -- you're compensated at the price you chose.

**Example (V1):**

Tile priced at 0.5 ETH, effective price after decay = 0.45 ETH, seller has 0.1 ETH deposit.

Buyer wants to set new price at 0.8 ETH:
- Effective price: 0.45 ETH -> seller
- Buyout fee: 0.045 ETH -> 40% holders (0.018), 60% dev (0.027)
- Appreciation tax: (0.8 - 0.45) * 30% = 0.105 ETH -> 40% holders, 60% dev
- New deposit: 0.8 * 5% = 0.04 ETH minimum
- **Buyer total: ~0.64 ETH**
- **Seller receives: 0.45 + 0.1 = 0.55 ETH**

### 5. Price Decay

To prevent speculation (claiming at a high price and sitting on it indefinitely), tile prices decay over time:

- **Rate**: 20% per 2-week period after the last buyout
- **Floor**: Price never drops below 10% of the original declared price
- **Effect**: Makes buyouts cheaper over time, encouraging active participation
- **Cap**: Maximum 20 decay periods applied (prevents gas exhaustion)

```
effective_price = declared_price * (1 - 0.20)^(weeks_since_buyout / 2)
```

Partial periods are interpolated linearly.

**Example:** Tile priced at 1 ETH, 4 weeks since last buyout:
- Decay periods: 4 / 2 = 2
- Effective price: 1.0 * (0.80)^2 = 0.64 ETH

This applies identically to both V1 and V2.

### 6. Abandoning a Tile

You can voluntarily give up a tile:

```
abandonTile(tileIndex)
```

- Outstanding tax is collected first
- Your remaining deposit is returned to you
- The tile becomes unclaimed and available for anyone
- In V2, Founder status is cleared -- the tile can be reclaimed as either tier

### 7. Foreclosure

If your deposit runs out (tax > deposit), anyone can trigger foreclosure:

```
pokeTax(tileIndex)
```

- The tile is seized and becomes unclaimed
- **You lose your remaining deposit** (it's consumed by tax)
- Any partial tax collected before foreclosure still gets split per the fee rules
- This is the penalty for not maintaining your deposit

**Prevention**: Monitor your deposit and top up with `addDeposit()` before it runs out. The frontend shows deposit health and warnings.

**Note:** Foreclosure can also happen implicitly -- any function that calls `_applyTax()` internally (buyout, setPrice, withdrawDeposit, abandon) can trigger foreclosure if the deposit is exhausted.

---

## Commission System

### How Commissions Work

Both contracts use a gas-efficient global accumulator (`globalRewardPerShare`) instead of iterating over all holders:

```
1. Fees arrive in treasury (from tax collection, external ETH, etc.)
2. distributeFees() is called:
   V1: globalRewardPerShare += treasuryBalance / totalActiveTiles
   V2: globalRewardPerShare += treasuryBalance / totalShares
3. For each tile holder:
   V1: pending = (globalRewardPerShare - player.rewardSnapshot) * player.tileCount
   V2: pending = (globalRewardPerShare - player.rewardSnapshot) * player.shareCount
4. Player calls claimFees() to withdraw pending amount
```

The key difference: **V1 divides by tile count** (all tiles equal), while **V2 divides by total shares** (Founder tiles get 5x weight).

Direct ETH sent to the contract via `receive()` bypasses the treasury and updates `globalRewardPerShare` immediately -- no need to call `distributeFees()`.

### V1 Commission Example

**Scenario:** You own 2 tiles. There are 80 active tiles total. A market resolves with 10 ETH pool.

```
Protocol fee: 10 ETH * 5% = 0.5 ETH -> sent to V1 contract

receive() triggers immediate distribution:
  globalRewardPerShare += 0.5 ETH / 80 tiles = 0.00625 ETH per tile

Your pending commission:
  0.00625 * 2 tiles = 0.0125 ETH

You call claimFees() -> receive 0.0125 ETH
```

### V2 Commission Example

**Scenario:** You own 1 Founder tile (5 shares). There are 50 active tiles total: 10 Founder (50 shares) + 40 Normal (40 shares) = 90 total shares.

A Harberger tax collection yields 1 ETH total. 30% goes to holders (treasury):

```
Treasury receives: 1.0 * 30% = 0.3 ETH
Dev receives: 1.0 * 70% = 0.7 ETH

distributeFees() called:
  globalRewardPerShare += 0.3 ETH / 90 shares = 0.00333 ETH per share

Your pending commission (1 Founder tile = 5 shares):
  0.00333 * 5 = 0.01667 ETH

A Normal tile holder (1 share):
  0.00333 * 1 = 0.00333 ETH

Your Founder tile earns 5x what a Normal tile earns.
```

### Revenue Sources by Series

**V1 holders earn from:**
- Prediction market fees (5% of pool) routed to the contract
- Flaunch token trading fees (via `claimFlaunchFees`)
- 50% of Harberger tax
- 40% of buyout fees, appreciation taxes, claim fees
- Any direct ETH sent to the contract

**V2 holders earn from:**
- 30% of Harberger tax
- Any direct ETH sent to the contract (e.g., market fees routed to V2)

### Monthly Projection (Hypothetical)

**V1** -- 200 markets/month, avg 5 ETH pool, 80 active tiles:
```
Monthly volume: 200 * 5 = 1,000 ETH
Monthly market fees: 1,000 * 5% = 50 ETH to V1 contract
Per tile: 50 / 80 = 0.625 ETH/month
For 2 tiles: 1.25 ETH/month
```

**V2** -- Same volume routed to V2, 90 total shares:
```
Monthly external ETH: 50 ETH to V2 contract
Per share: 50 / 90 = 0.556 ETH/share/month
1 Founder tile (5 shares): 2.778 ETH/month
1 Normal tile (1 share): 0.556 ETH/month
```

---

## Fee Distribution Flow

### V1 Flow

```
            PREDICTION MARKET RESOLVES
                      |
            5% fee collected (0.5 ETH on 10 ETH pool)
                      |
                      v
            +-------------------+
            |  V1 Contract      |
            |  receive()        |
            +-------------------+
                      |
            Immediate distribution (no distributeFees() needed)
                      |
            globalRewardPerShare += fee / totalActiveTiles
                      |
                 /    |    \
                /     |     \
           Tile 0  Tile 1  ... Tile 99
           1 share 1 share    1 share
              |       |          |
          claimFees() each holder calls when ready


            TILE ECONOMY FEES (taxes, buyouts, claim fees)
                      |
            Split at collection time
                      |
            +-------------------+    +-------------------+
            | Treasury (40-50%) |    | Dev (50-60%)      |
            +-------------------+    +-------------------+
                      |                        |
            distributeFees()           claimDevFees()
                      |
            globalRewardPerShare increases
                      |
            Same per-tile distribution as above


            FLAUNCH TRADING FEES
                      |
            claimFlaunchFees(feeEscrow)
                      |
            ETH arrives via receive()
                      |
            100% distributed to holders immediately
```

### V2 Flow

```
            HARBERGER TAX COLLECTED
                      |
            _applyTax() on any tile
                      |
            +-------------------+    +-------------------+
            | Treasury (30%)    |    | Dev (70%)         |
            +-------------------+    +-------------------+
                      |                        |
            distributeFees()           claimDevFees()
                      |
            globalRewardPerShare += treasury / totalShares
                      |
                 /    |    \
                /     |     \
           Tile 0  Tile 1  ... Tile 99
           5 shr   1 shr      1 shr   (shares vary by tier)
              |       |          |
          claimFees() each holder calls when ready


            EXTERNAL ETH (market fees, etc.)
                      |
            Sent to V2 contract address
                      |
            receive() -> immediate distribution
                      |
            globalRewardPerShare += amount / totalShares
                      |
            Same share-weighted distribution as above


            BUYOUT / APPRECIATION / CLAIM FEES
                      |
            100% to devPending
                      |
            claimDevFees() -> dev wallet
            (holders get nothing from these events in V2)
```

---

## Strategy Guide

### For New Users

1. **Claim your first tile** -- it's free in V1 (just the deposit). In V2, you pay the tier price (0.1 or 0.5 ETH) plus deposit.
2. **Set a fair price** -- too low and you'll be bought out; too high and tax eats your deposit.
3. **Monitor your deposit** -- if it runs out, you lose the tile AND the remaining deposit.
4. **Claim commissions regularly** -- fees accumulate, but you must call `claimFees()` to withdraw.

### Choosing a Series

| Goal | Best Choice | Why |
|------|-------------|-----|
| Earn from Flaunch token trading | V1 | Only V1 has Flaunch integration |
| Earn from market fees | V1 (currently) | Market fees currently route to V1 |
| Maximize commission weight | V2 Founder | 5 shares per tile = 5x commissions |
| Buyout immunity | V2 Founder | Cannot be forced out |
| Low entry cost | V1 | Just a tax deposit (0.01 ETH min price * 5% = 0.0005 ETH) |
| No wallet tile limit | V2 | V1 caps at 5 tiles per wallet |

### V2 Tier Strategy

**Founder Tier (0.5 ETH upfront + deposit):**
- 5x commission weight per tile
- Cannot be bought out -- permanent ownership as long as deposit is maintained
- Higher tax burden (tax is on self-assessed price, not tier price)
- Best for long-term holders who want guaranteed position

**Normal Tier (0.1 ETH upfront + deposit):**
- 1x commission weight per tile
- Can be bought out at any time
- Lower cost of entry
- Good for testing the waters or speculating on tile value

### Pricing Strategy

| Strategy | Price Level | Risk | Reward |
|----------|-------------|------|--------|
| **Passive holder** | Low (0.01-0.05 ETH) | High buyout risk (V1/V2 Normal) | Low tax, cheap to maintain |
| **Active holder** | Medium (0.1-0.5 ETH) | Balanced | Moderate tax, decent protection |
| **Defender** | High (0.5-2 ETH) | Low buyout risk | High tax, expensive to maintain |
| **V2 Founder** | Any price | Zero buyout risk | Tax is only risk |

**Optimal**: Price at what you'd genuinely be willing to sell for. The Harberger model is designed so that honest pricing is the dominant strategy. For V2 Founder tiles, price just above minimum to minimize tax (since you can't be bought out anyway).

### Tile Investment Math

To evaluate if a tile is worth holding:

```
Annual tax cost = declared_price * 5% * 52 weeks = declared_price * 2.6

Break-even: annual_commissions >= annual_tax_cost

If total annual volume = V ETH, and there are T active tiles (V1) or S total shares (V2):

V1: annual_commission_per_tile = V * 5% / T
V2: annual_commission_per_share = external_ETH_per_year / S
    Founder annual commission = annual_commission_per_share * 5
    Normal annual commission = annual_commission_per_share * 1

Break-even price = annual_commission / 2.6
```

**V1 Example:** If annual volume is 10,000 ETH and 80 tiles are active:
- Annual commission per tile: 10,000 * 5% / 80 = 6.25 ETH
- Break-even price: 6.25 / 2.6 = **2.4 ETH**
- Any declared price below 2.4 ETH is profitable to hold

**V2 Founder Example:** If 100 ETH/year in external ETH is sent to V2, with 90 total shares:
- Annual commission per share: 100 / 90 = 1.11 ETH
- Founder tile (5 shares): 5.56 ETH/year
- Break-even price: 5.56 / 2.6 = **2.14 ETH**
- Plus 30% of tax also goes to holders (additional income)

---

## Technical Details

### Data Structures

#### V1

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
    uint8[5] tilesOwned;     // Fixed array of tile indices (0xFF = empty slot)
}
```

#### V2

```solidity
struct TileData {
    address owner;
    uint80  price;
    uint96  deposit;
    uint40  lastTaxTime;
    uint40  lastBuyoutTime;
    bool    isFounder;       // NEW: determines tier (5 shares vs 1)
}

struct PlayerState {
    uint128 rewardSnapshot;
    uint96  accumulatedFees;
    uint32  shareCount;      // NEW: total shares across all owned tiles
    uint8   tileCount;       // Number of tiles owned
    // No fixed array -- V2 uses mapping(address => uint8[]) playerTiles
}
```

Key differences:
- V2 `TileData` has `isFounder` to track the tier
- V2 `PlayerState` has `shareCount` (sum of shares across tiles) instead of a fixed 5-slot array
- V2 uses a dynamic `uint8[]` array per player (via `playerTiles` mapping), so there is **no hard wallet limit**
- V1 uses a fixed `uint8[5]` array with `0xFF` sentinel values and enforces `MAX_TILES_PER_WALLET = 5`

### Contract Functions

#### Tile Management

| Function | V1 | V2 | Description |
|----------|----|----|-------------|
| `claimTile(tileIndex, price)` | Yes | -- | Claim an unclaimed tile (V1) |
| `claimTile(tileIndex, price, founder)` | -- | Yes | Claim with tier selection (V2) |
| `buyoutTile(tileIndex, newPrice)` | Yes | Yes | Force-buy a claimed tile (V2: reverts on Founder tiles) |
| `abandonTile(tileIndex)` | Yes | Yes | Give up tile, recover deposit |
| `setPrice(tileIndex, newPrice)` | Yes | Yes | Change self-assessed price |
| `addDeposit(tileIndex)` | Yes | Yes | Top up tax deposit |
| `withdrawDeposit(tileIndex, amount)` | Yes | Yes | Withdraw excess deposit |
| `pokeTax(tileIndex)` | Yes | Yes | Trigger tax collection (can foreclose) |

#### Commission Management

| Function | V1 | V2 | Description |
|----------|----|----|-------------|
| `distributeFees()` | Yes | Yes | Distribute treasury to all holders |
| `claimFees()` | Yes | Yes | Withdraw accumulated commissions |
| `claimDevFees()` | Yes | Yes | Withdraw dev share |
| `pendingFees(player)` | Yes | Yes | Check unclaimed commission amount |
| `claimFlaunchFees(feeEscrow)` | Yes | -- | Claim Flaunch trading fees (V1 only) |

#### View Functions

| Function | V1 | V2 | Returns |
|----------|----|----|---------|
| `getTile(tileIndex)` | Yes | Yes | TileData for a specific tile |
| `getAllTiles()` | Yes | Yes | Array of all 100 TileData structs |
| `getPlayer(address)` | Yes | Yes | PlayerState for a wallet |
| `getPlayerTiles(address)` | -- | Yes | Dynamic array of tile indices (V2 only) |
| `effectivePrice(tileIndex)` | Yes | Yes | Price after decay |
| `totalActiveTiles()` | Yes | -- | Number of claimed tiles (V1) |
| `totalShares()` | -- | Yes | Total share count across all tiles (V2) |
| `treasuryBalance()` | Yes | Yes | Current undistributed fees |

### Events

Both contracts emit similar events. V2 adds `isFounder` to `TileClaimed`:

```solidity
// V1
event TileClaimed(uint256 tileIndex, address owner, uint256 price, uint256 deposit);

// V2
event TileClaimed(uint8 tileIndex, address owner, uint80 price, bool isFounder, uint96 deposit);
```

Common events (both series):
```solidity
event TileBuyout(tileIndex, newOwner, prevOwner, effectivePrice, newPrice, buyoutFee, appreciationTax);
event TileAbandoned(tileIndex, owner, depositReturned);
event PriceChanged(tileIndex, oldPrice, newPrice, appreciationTax);
event TaxCollected(tileIndex, taxAmount, devCut);
event TileForeclosed(tileIndex, formerOwner);
event FeesDistributed(amount);
event FeesClaimed(player, amount);
event DevFeesClaimed(devWallet, amount);
event EmergencyWithdraw(to, amount);
```

V1-only events:
```solidity
event ClaimFeeCollected(tileIndex, claimFee, devCut);
event MemeStreamReceived(nftAddress, tokenId);
event FlaunchFeesClaimed(feeEscrow, amount);
```

V2-only events:
```solidity
event DepositAdded(tileIndex, amount);
event DepositWithdrawn(tileIndex, amount);
```

### Safety Features

Both contracts share:
- **ReentrancyGuard**: All state-changing functions protected
- **Pause mechanism**: Authority can pause all operations in emergencies
- **Emergency withdraw**: After timelock period (V1: 90 days, V2: 30 days), authority can recover stuck funds
- **Min price floor**: 0.01 ETH prevents zero-price griefing
- **Max price increase**: 3x effective price per transaction
- **Checks-effects-interactions**: External calls (ETH transfers) always happen last

V1 additionally has:
- **Max tiles per wallet**: 5 (prevents monopolization)
- **Generic execute()**: Authority can make external calls (but not to the contract itself)

---

## FAQ

**Q: What's the difference between Series 1 and Series 2?**
A: Different fee structures and ownership models. V1 has equal 1-share tiles with a 5-per-wallet limit and Flaunch integration. V2 introduces Founder tiles (5 shares, buyout-immune) and Normal tiles (1 share), with no wallet limit but a different fee split where holders get less from tile economy events and more from external ETH.

**Q: Can Founder tiles be bought out?**
A: No. The `buyoutTile()` function reverts with `CannotBuyoutFounder()`. Founder tiles can only change hands if the owner abandons the tile or gets foreclosed for running out of deposit.

**Q: Which series should I choose?**
A: V1 if you want Flaunch trading fees and market fees (the current main revenue source). V2 Founder if you want 5x commission weight and buyout immunity. V2 Normal if you want a cheaper entry into V2 or don't want wallet limits.

**Q: What happens if all tiles are claimed?**
A: You must buy one from an existing holder via `buyoutTile()`. The Harberger model ensures tiles are always available at a price -- except V2 Founder tiles, which can only be acquired if the owner abandons or gets foreclosed.

**Q: Can I lose money holding a tile?**
A: Yes. If your commissions don't cover your tax, you're losing money. Lower your price to reduce tax, or abandon the tile. For V2 Founder tiles, you also paid a non-refundable 0.5 ETH tier price upfront.

**Q: What happens to my commissions if I get bought out?**
A: Accumulated commissions are preserved. You can still call `claimFees()` after losing your tile. However, you stop earning new commissions.

**Q: How often should I claim commissions?**
A: Whenever you want. There's no deadline -- commissions accumulate indefinitely. But gas costs apply to each claim, so batching is more efficient.

**Q: What happens if nobody calls `distributeFees()`?**
A: Fees accumulate in the treasury. Anyone can call `distributeFees()` -- it's a public function. The frontend triggers it periodically. Direct ETH received via `receive()` is distributed automatically without needing `distributeFees()`.

**Q: Will new market types (BTC 5min, etc.) require a new contract?**
A: No. New markets send fees to the same treasury via `receive()`, which distributes to tile holders automatically. New markets are additive -- they increase the fee pool without any contract changes.

**Q: Can the dev change the fee split?**
A: No. All fee percentages in both V1 and V2 are hardcoded as `constant` values in the contracts. Grid size (100), tax rate (5%/week), buyout fee (10%), appreciation tax (30%), and all split ratios are immutable.

**Q: If a Founder tile gets foreclosed, can someone reclaim it as Normal?**
A: Yes. When a tile is foreclosed or abandoned, the `isFounder` flag is cleared. The next person to claim it can choose either tier.

**Q: Do V1 and V2 share a treasury?**
A: No. They are completely independent contracts with separate treasuries, separate tile grids, and separate commission pools. Revenue must be routed to each contract explicitly.
