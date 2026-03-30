# Rush Protocol — Smart Contracts

Solidity contracts for the Rush on-chain prediction market, deployed on **Base Mainnet**.

## Contracts

| Contract | Description | Lines |
|----------|-------------|-------|
| [`MarketFactory.sol`](src/MarketFactory.sol) | Factory that deploys individual prediction market instances | ~200 |
| [`PredictionMarket.sol`](src/PredictionMarket.sol) | Pari-mutuel betting pool with auto-distribution | ~500 |
| [`RushTiles.sol`](src/RushTiles.sol) | 100 revenue-sharing quotas with Harberger tax | ~450 |
| [`OracleRegistry.sol`](src/OracleRegistry.sol) | Oracle staking, registration, and slashing | ~250 |
| [`DataAttestation.sol`](src/DataAttestation.sol) | Commit-reveal scheme for oracle honesty | ~250 |
| [`ConsensusEngine.sol`](src/ConsensusEngine.sol) | Multi-oracle median consensus with tolerance | ~300 |
| [`DisputeManager.sol`](src/DisputeManager.sol) | Post-resolution dispute handling with challenger deposits | ~350 |

## Deployed Addresses (Base Mainnet)

```
MarketFactory:  0x5b04F3DFaE780A7e109066E754d27f491Af55Af9
RushTiles:      0x6cE3873e31Ab5440fA6AF1860F8E36110504c9C4
Oracle Signer:  0x4c385830c2E241EfeEd070Eb92606B6AedeDA277
Fee Recipient:  0xdd12D83786C2BAc7be3D59869834C23E91449A2D
```

All contracts are **verified on Basescan** — source code is publicly readable.

## Build & Test

Requires [Foundry](https://book.getfoundry.sh/getting-started/installation).

```bash
forge install          # Install dependencies (OpenZeppelin, forge-std)
forge build            # Compile
forge test             # Run all tests (155 passing)
forge test -vvv        # Verbose output
forge coverage         # Code coverage
forge fmt              # Format code
```

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

### Pari-Mutuel (No House Edge)

Markets use a pari-mutuel pool — the protocol never takes a position. Winners split the entire pool minus a flat 5% fee. Odds are purely determined by the bet distribution.

### Per-Market Contracts

Each round deploys a new `PredictionMarket` instance via the factory. This isolates risk, simplifies state management, and makes each market independently verifiable.

### Harberger Tax Tiles

Revenue sharing uses a Harberger tax model instead of NFTs. This ensures:
- Tiles flow to those who value them most (self-assessed pricing)
- No indefinite hoarding (continuous tax obligation)
- Fair buyout mechanism (seller always gets their declared price)

### Commit-Reveal Oracle

Oracles commit a hash of their count before revealing. This prevents front-running and copying between oracles in a multi-oracle setup.

## Security

- **ReentrancyGuard** (OpenZeppelin) on all payable functions
- **Checks-effects-interactions** pattern throughout
- **Safe transfers** for batch operations (individual failures don't revert)
- **Slither** static analysis — zero critical findings
- **Emergency withdraw** with 90-day timelock
- **Max price caps** prevent manipulation (3x max increase per tx)

## License

MIT
