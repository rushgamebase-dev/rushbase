# Rush Protocol — Smart Contracts

Solidity contracts for the Rush on-chain prediction market, deployed on **Base Mainnet**.

## Contracts

| Contract | Description | Lines | Status |
|----------|-------------|-------|--------|
| [`MarketFactory.sol`](src/MarketFactory.sol) | Factory for ETH prediction markets | ~200 | Production |
| [`PredictionMarket.sol`](src/PredictionMarket.sol) | ETH pari-mutuel betting pool with auto-distribution | ~500 | Production |
| [`RushTiles.sol`](src/RushTiles.sol) | Series 1: 100 tiles, 1 share each, Harberger tax, Flaunch integration | ~700 | Production |
| [`RushTilesV2.sol`](src/RushTilesV2.sol) | Series 2: Founder (0.5 ETH, 5 shares) + Normal (0.1 ETH, 1 share) tiers | ~590 | Production |
| [`BurnMarketFactory.sol`](src/BurnMarketFactory.sol) | Factory for $RUSH-denominated markets with 70/30 burn (earlier format) | ~130 | Archived |
| [`BurnMarket.sol`](src/BurnMarket.sol) | $RUSH market: 70% to winners, 30% burned to 0xdead (earlier format) | ~300 | Archived |
| [`OracleRegistry.sol`](src/OracleRegistry.sol) | Oracle staking, registration, and slashing | ~250 | Dormant |
| [`DataAttestation.sol`](src/DataAttestation.sol) | Commit-reveal scheme for oracle honesty | ~250 | Dormant |
| [`ConsensusEngine.sol`](src/ConsensusEngine.sol) | Multi-oracle median consensus with tolerance | ~300 | Dormant |
| [`DisputeManager.sol`](src/DisputeManager.sol) | Post-resolution dispute handling with challenger deposits | ~350 | Dormant |

## Deployed Addresses (Base Mainnet)

```
MarketFactory (production):     0x5b04F3DFaE780A7e109066E754d27f491Af55Af9
RushTiles V1 (Series 1):        0x6cE3873e31Ab5440fA6AF1860F8E36110504c9C4
RushTiles V2 (Series 2):        0x5b7b2a6AC4f3A017fb943C9F550d609174532fFF
$RUSH Token (trading asset):    0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b
BurnMarketFactory (archived):   0xf3edae04f632bc4cfde9a08e06f36a17bfaee83f
Oracle/Admin Signer:            0x4c385830c2E241EfeEd070Eb92606B6AedeDA277
Fee Recipient (dev):            0xdd12D83786C2BAc7be3D59869834C23E91449A2D
```

All contracts are **verified on Basescan** — source code is publicly readable.

## Build & Test

Requires [Foundry](https://book.getfoundry.sh/getting-started/installation).

```bash
forge install          # Install dependencies (OpenZeppelin, forge-std)
forge build            # Compile
forge test             # Run all tests
forge test -vvv        # Verbose output
forge coverage         # Code coverage
forge fmt              # Format code
```

Test suites exist for: PredictionMarket, RushTiles, ConsensusEngine, DataAttestation, OracleRegistry, and integration tests. BurnMarket, BurnMarketFactory, and RushTilesV2 do not have dedicated Foundry tests.

## Deploy

```bash
# Set environment variables
export PRIVATE_KEY=<deployer private key>
export FEE_RECIPIENT=<address for protocol fees>
export FEE_BPS=500  # 5% (optional, default 500)

# Deploy MarketFactory + RushTiles
forge script script/Deploy.s.sol \
  --broadcast \
  --rpc-url https://mainnet.base.org \
  --verify \
  --etherscan-api-key <basescan key>
```

## Key Design Decisions

### Production Market System

- **ETH markets** (`MarketFactory` + `PredictionMarket`): Pari-mutuel pool with a 5% fee distributed to RushTiles holders. ETH-denominated betting is the current active system because every Base user can participate without holding an additional token.
- **Archived: $RUSH markets** (`BurnMarketFactory` + `BurnMarket`): Earlier $RUSH-denominated format that burned 30% of each pool. Contracts remain verified on Basescan but are no longer used for new rounds.

### Per-Market Contracts

Each round deploys a new `PredictionMarket` instance via its factory. This isolates risk, simplifies state management, and makes each market independently verifiable.

### Harberger Tax Tiles

Revenue sharing uses a Harberger tax model instead of NFTs:
- **V1 (Series 1)**: 100 tiles, 1 share each, equal weight. Flaunch integration for $RUSH trading fees. Emergency withdraw with 90-day timelock.
- **V2 (Series 2)**: Two tiers — Founder tiles (0.5 ETH, 5 shares, buyout-immune) and Normal tiles (0.1 ETH, 1 share). Emergency withdraw with 30-day timelock.

Both ensure tiles flow to those who value them most (self-assessed pricing), prevent indefinite hoarding (continuous tax), and provide fair buyout (seller gets declared price).

### Dormant Oracle Infrastructure

OracleRegistry, DataAttestation, ConsensusEngine, and DisputeManager are deployed code but **not used in production**. The current system runs a single trusted oracle with no on-chain staking or dispute enforcement. This infrastructure is ready for a multi-oracle future where commit-reveal, median consensus, and slashing become necessary.

## Security

- **ReentrancyGuard** (OpenZeppelin) on all payable functions
- **Checks-effects-interactions** pattern throughout
- **Safe transfers** for batch operations (individual failures don't revert)
- **Slither** static analysis — zero critical findings
- **Emergency withdraw** with timelock (90 days V1, 30 days V2)
- **Max price caps** prevent manipulation (3x max increase per tx)

## License

MIT
