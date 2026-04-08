# Rush Frontend — On-Chain Prediction Market UI

Next.js 14 frontend for the Rush prediction market protocol on Base. Real-time vehicle detection, wallet-connected betting, and tile management.

## Pages

| Route | Description |
|-------|-------------|
| `/` | Main game — live camera, betting panel, round status |
| `/tiles` | Series 1 tile grid — claim, manage, view holders |
| `/series2` | Series 2 tile grid — Founder and Normal tiers |
| `/stats` | Platform analytics — volume, rounds, bettors |
| `/profile/[address]` | User profile — bet history, P&L, tiles |
| `/docs` | Protocol documentation |
| `/admin` | Admin panel |

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS, Framer Motion
- **Web3**: wagmi v2, viem, RainbowKit
- **Real-time**: Ably (market events), WebSocket (live detection)

## Getting Started

```bash
npm install
npm run dev        # http://localhost:3000
```

## Environment Variables

Create `.env.local`:

```
NEXT_PUBLIC_CONTRACT_ADDRESS=<factory address>
```

Additional server-side variables needed for API routes (see team for values).

## Project Structure

```
frontend/
├── app/              # Next.js App Router pages + API routes
│   ├── api/          # 13 REST API endpoints
│   ├── docs/         # Documentation page
│   ├── tiles/        # Series 1 tiles
│   ├── series2/      # Series 2 tiles
│   ├── stats/        # Analytics
│   └── profile/      # User profiles
├── components/       # React components
├── hooks/            # Custom hooks (wagmi, WebSocket, Ably)
├── lib/              # Utilities, contract ABIs, addresses
└── public/           # Static assets
```

## Key Libraries

- `wagmi` v2 + `viem` — Contract reads/writes, wallet connection
- `@rainbow-me/rainbowkit` — Wallet modal
- `ably` — Real-time event subscription
- `framer-motion` — Animations
- `tailwindcss` — Styling

## Deployment

Deployed on Vercel. Push to main triggers auto-deploy.

## Links

- Live: [rushgame.vip](https://rushgame.vip)
- Contracts: See [docs/CONTRACTS.md](../docs/CONTRACTS.md)
- API Reference: See [docs/API.md](../docs/API.md)
