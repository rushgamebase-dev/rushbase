# Rush — On-Chain Prediction Market

**The first fully transparent prediction market on Base Chain.**

Predict vehicle counts on live cameras. Verified by AI. Settled on-chain. No house edge.

🌐 **[rushgame.vip](https://rushgame.vip)** | 📄 **[Contracts on Basescan](https://basescan.org/address/0x7b51C8C92f24Ef705E9C5c6f77ffA819b9733f4c)** | 🐦 **[@rushgamebase](https://x.com/rushgamebase)**

---

## How It Works

1. **Connect Wallet** — MetaMask or Phantom on Base
2. **Place Your Prediction** — Over or Under on vehicle count
3. **Watch Live** — AI counts vehicles on real traffic cameras
4. **Win ETH** — Correct predictions split the pool (5% protocol fee)

Every bet is an on-chain transaction. Every result is verifiable. No house edge — pari-mutuel pool.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Frontend (Next.js 14)                              │
│  rushgame.vip                                       │
│  wagmi + viem for contract interaction              │
├─────────────────────────────────────────────────────┤
│  Smart Contracts (Base Chain)                       │
│  MarketFactory → PredictionMarket instances         │
│  RushTiles → Revenue-sharing tiles (Harberger tax)  │
├─────────────────────────────────────────────────────┤
│  Oracle (Python + YOLO)                             │
│  YOLOv8 vehicle detection + BoT-SORT tracking       │
│  WebSocket → live video to frontend                 │
│  Creates & resolves markets on-chain                │
└─────────────────────────────────────────────────────┘
```

## Smart Contracts (Base Mainnet)

| Contract | Address | Verified |
|----------|---------|----------|
| MarketFactory | [`0x7b51C8C92f24Ef705E9C5c6f77ffA819b9733f4c`](https://basescan.org/address/0x7b51C8C92f24Ef705E9C5c6f77ffA819b9733f4c) | ✅ |
| RushTiles | [`0xaCa403BbDE42836146b681AC7B26CE44E875c651`](https://basescan.org/address/0xaCa403BbDE42836146b681AC7B26CE44E875c651) | ✅ |

### MarketFactory
Creates prediction market instances. Each market has:
- Stream URL (live camera)
- Description
- Duration (default: 5 minutes)
- Two outcomes: Under X / Over X
- Min/max bet limits

### PredictionMarket
Individual market instances:
- **Pari-mutuel pool** — bettors compete against each other, not the house
- **5% flat fee** — only protocol revenue, zero house edge
- **ETH bets** — direct, no token wrapping needed
- **Instant settlement** — claim winnings immediately after resolution

### RushTiles
100 revenue-sharing tiles with Harberger tax economics:
- **1 tile = 1 share** of platform trading fees
- **Buyout mechanism** — any tile can be forcibly acquired at a premium
- **5%/week Harberger tax** — prevents hoarding
- **30% appreciation tax** — prevents price manipulation
- Inspired by [takeover.fun](https://takeover.fun)

## Fee Structure

| Source | Rate | Recipient |
|--------|------|-----------|
| Prediction pool | 5% | Protocol |
| Tile Harberger tax | 5%/week | Tile holders |
| Tile buyout fee | 10% | Tile holders |
| Tile appreciation tax | 30% | Protocol |
| $RUSH creator fees | 100% | Tile holders |

## Tech Stack

**Frontend:** Next.js 14, TypeScript, Tailwind CSS, wagmi v2, viem, Framer Motion

**Contracts:** Solidity 0.8.24, Foundry, OpenZeppelin

**Oracle:** Python, YOLOv8, Supervision, BoT-SORT, OpenCV, WebSocket

**Infrastructure:** Base Chain, Chainstack RPC, Cloudflare Tunnel, Railway

## Development

### Smart Contracts

```bash
cd contracts
forge install
forge build
forge test    # 155 tests
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Oracle

```bash
cd oracle
pip install -r requirements.txt
python3 round_manager_rush.py
```

## Security

- **155 contract tests** — comprehensive coverage
- **Slither audited** — zero critical vulnerabilities
- **ReentrancyGuard** — OpenZeppelin on all payable functions
- **Checks-effects-interactions** — state changes before external calls
- **Emergency withdraw** — 90-day timelock for stuck funds
- **Verified on Basescan** — open source, fully auditable

## License

MIT

---

**Built on Base.** Transparent. Verifiable. No house edge.
