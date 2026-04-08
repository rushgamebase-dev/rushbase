# Rush Protocol — Smart Contracts

Solidity contracts for the Rush on-chain prediction market, deployed on **Base Mainnet**.

## Contracts

| Contract | Description | Lines | Status |
|----------|-------------|-------|--------|
| [`MarketFactory.sol`](src/MarketFactory.sol) | Factory for ETH prediction markets (legacy) | ~200 | Production |
| [`PredictionMarket.sol`](src/PredictionMarket.sol) | ETH pari-mutuel betting pool with auto-distribution | ~500 | Production |
| [`BurnMarketFactory.sol`](src/BurnMarketFactory.sol) | Factory for $RUSH token markets with 70/30 burn | ~130 | Production |
| [`BurnMarket.sol`](src/BurnMarket.sol) | $RUSH token market: 70% to winners, 30% burned to 0xdead | ~300 | Production |
| [`RushTiles.sol`](src/RushTiles.sol) | Series 1: 100 tiles, 1 share each, Harberger tax | ~700 | Production |
| [`RushTilesV2.sol`](src/RushTilesV2.sol) | Series 2: Founder (0.5 ETH, 5 shares) + Normal (0.1 ETH, 1 share) tiers | ~590 | Production |
| [`OracleRegistry.sol`](src/OracleRegistry.sol) | Oracle staking, registration, and slashing | ~250 | Dormant |
| [`DataAttestation.sol`](src/DataAttestation.sol) | Commit-reveal scheme for oracle honesty | ~250 | Dormant |
| [`ConsensusEngine.sol`](src/ConsensusEngine.sol) | Multi-oracle median consensus with tolerance | ~300 | Dormant |
| [`DisputeManager.sol`](src/DisputeManager.sol) | Post-resolution dispute handling with challenger deposits | ~350 | Dormant |

## Deployed Addresses (Base Mainnet)

```
BurnMarketFactory (production): 0xf3edae04f632bc4cfde9a08e06f36a17bfaee83f
MarketFactory (legacy ETH):     0x5b04F3DFaE780A7e109066E754d27f491Af55Af9
RushTiles V1 (Series 1):        0x6cE3873e31Ab5440fA6AF1860F8E36110504c9C4
RushTiles V2 (Series 2):        0x5b7b2a6AC4f3A017fb943C9F550d609174532fFF
$RUSH Token:                    0xB36A127dBa73F3aA7C70B4e00B7395B86A60e73b
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

Test suites exist for: PredictionMarket, RushTiles, ConsensusEngine, DataAttestation, OracleRegistry, and integration tests. BurnMarket, BurnMarketFactory, and RushTilesV2 do not have tests yet.

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

### Two Market Systems

- **ETH markets** (legacy via `MarketFactory`): Pari-mutuel pool with a 5% fee distributed to tile holders.
- **$RUSH markets** (current via `BurnMarketFactory`): 0% protocol fee. 70% of the pool goes to winners, 30% is burned to `0x000...dead`. This is the active system.

### Per-Market Contracts

Each round deploys a new `PredictionMarket` or `BurnMarket` instance via its factory. This isolates risk, simplifies state management, and makes each market independently verifiable.

### Harberger Tax Tiles

Revenue sharing uses a Harberger tax model instead of NFTs:
- **V1 (Series 1)**: 100 tiles, 1 share each, equal weight. Emergency withdraw with 90-day timelock.
- **V2 (Series 2)**: Two tiers — Founder tiles (0.5 ETH, 5 shares) and Normal tiles (0.1 ETH, 1 share). Emergency withdraw with 30-day timelock.

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
