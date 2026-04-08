# $RUSH Token — Deflationary Prediction Market Token

## Overview

- **$RUSH** is the native token of the Rush prediction market protocol on Base
- Launched via [Flaunch](https://flaunch.gg)
- **Address:** `0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b`
- **Chain:** Base Mainnet (8453)
- **Standard:** ERC20

## Burn Mechanics

The core innovation: every $RUSH prediction market burns 30% of the total pool.

```
Total Pool (100% $RUSH bets)
  |-- 70% -> Winners (proportional to bet size)
  |-- 30% -> Burned forever (sent to 0x000...dEaD)
```

- **BURN_BPS** = 3000 (30%), hardcoded and immutable
- **BURN_ADDRESS** = `0x000000000000000000000000000000000000dEaD`
- Zero protocol fees on $RUSH markets (feeBps=0)
- The burn is deflationary: every resolved market permanently reduces supply

## How It Works

1. Users approve $RUSH spending for the BurnMarket contract
2. Users call `placeBetToken(rangeIndex, amount)` to bet
3. Oracle counts vehicles and calls `resolveMarket(actualCount)`
4. Contract identifies winning range
5. 30% of totalPool is transferred to 0xdead (burned)
6. Remaining 70% is distributed proportionally to winners
7. `distributeAll()` auto-pays all winners

## Payout Formula

```
burnAmount = totalPool * 30%
distributable = totalPool - burnAmount  (70%)
userPayout = (userBet / winningRangePool) * distributable
```

**Example:** 10,000 $RUSH total pool, you bet 1,000 on the winning side (5,000 total on winning side)

- Burned: 3,000 $RUSH (gone forever)
- Distributable: 7,000 $RUSH
- Your payout: (1,000 / 5,000) * 7,000 = 1,400 $RUSH
- Your profit: 400 $RUSH

## Deflationary Impact

- Every round burns tokens regardless of outcome
- As volume grows, burn rate accelerates
- Supply can only decrease, never increase
- Contract tracks `totalBurned` per market for transparency

## Trading

- **Flaunch:** https://flaunch.gg/base/coins/0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b
- **DexScreener:** https://dexscreener.com/base/0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b
- **Basescan:** https://basescan.org/token/0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b

## Trading Fees & Tile Holders

- $RUSH was launched on Flaunch, which manages trading fee distribution
- Trading fees are managed by the DynamicAddressFeeSplitManager at `0x9eA9EEEAC3Cf3420DCb298DB1b1C6CA77E9F7462`
- Fee split is configured to distribute to RushTiles V1 holders proportionally
- This means tile holders earn from both prediction market activity AND token trading

## Contract Reference

- **BurnMarketFactory:** `0xf3edae04f632bc4cfde9a08e06f36a17bfaee83f`
- **BurnMarket:** new instance per round (deployed by factory)
- **Key functions:** `placeBetToken()`, `resolveMarket()`, `claimWinnings()`, `distributeAll()`
