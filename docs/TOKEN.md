# $RUSH Token

## Overview

$RUSH is the protocol's native trading asset on Base, launched via [Flaunch](https://flaunch.gg). It is a Flaunch-managed ERC20 whose creator fees are a continuous revenue stream for **RushTiles V1 holders**.

- **Address:** `0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b`
- **Chain:** Base Mainnet (8453)
- **Standard:** ERC20
- **Status:** Production (trading asset)

---

## What $RUSH Is Today

$RUSH is **not** used for active betting on the protocol. Bets are placed in ETH via the current `PredictionMarket` contract (see [CONTRACTS.md](CONTRACTS.md)).

$RUSH functions as:

1. A tradeable asset on Flaunch and aggregators (DexScreener, etc.)
2. A continuous fee source for RushTiles V1 holders -- every buy and sell of $RUSH on Flaunch generates creator fees that route back to tile holders
3. A protocol-aligned speculative position for supporters who want exposure to Rush's activity

---

## Flaunch Trading Fees → Tile Holders

Flaunch collects creator fees on every swap of $RUSH. These fees are managed by the **DynamicAddressFeeSplitManager** at `0x9eA9EEEAC3Cf3420DCb298DB1b1C6CA77E9F7462` and routed to the RushTiles V1 contract.

The V1 contract distributes all incoming ETH (including Flaunch fees) 100% to tile holders in proportion to tiles held:

```
$RUSH trade on Flaunch
         │
         ▼
Creator fee (Flaunch-managed)
         │
         ▼
RushTiles V1 contract (receive())
         │
         ▼
globalRewardPerShare += amount / totalActiveTiles
         │
         ▼
Each tile holder can claimFees() their share
```

### Claim Mechanism

Two ways Flaunch fees can reach V1:

- **Direct `receive()`:** When Flaunch's fee manager sends ETH to the V1 address, it is distributed immediately.
- **`claimFlaunchFees(feeEscrow)`:** V1 exposes an explicit helper that pulls accumulated fees from the Flaunch escrow. Anyone can call it; the ETH lands in V1 and is distributed the same way.

---

## Trading

- **Flaunch:** https://flaunch.gg/base/coins/0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b
- **DexScreener:** https://dexscreener.com/base/0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b
- **Basescan:** https://basescan.org/token/0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b

---

## Historical: $RUSH Burn Markets (Archived)

An earlier market format (`BurnMarketFactory` + `BurnMarket` at `0xf3edae04...`) used $RUSH tokens for betting with a 70/30 winner/burn split. This format was archived when the protocol consolidated on ETH-denominated markets. The contracts remain verified on Basescan for historical reference but are no longer used for new rounds.

No tokens are being actively burned by the protocol. $RUSH supply is whatever Flaunch manages.
