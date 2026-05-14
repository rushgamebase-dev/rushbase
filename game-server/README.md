# Rush Royale Game Server

NestJS backend for Rush Royale arena simulation, live spectating, arena ledger, admin tools, profiles, AI strategy templates, championship brackets, and blockchain settlement on Base.

## Local Run

```bash
npm install
cp .env.example .env
npm run db:generate
npm run dev
```

The server listens on `http://localhost:3001` by default. Health check: `GET /health`.

## Production Environment

Required:

- `DATABASE_URL`: PostgreSQL database used by Prisma and the arena ledger.
- `BASE_RPC_URL`: Base mainnet RPC.
- `EXECUTOR_PRIVATE_KEY`: wallet that can execute backend-only chain writes.
- `ADMIN_API_KEY`: bearer value for admin endpoints.
- `FRONTEND_URL`: production frontend, currently `https://www.rushgame.vip`.
- `GAME_SERVER_URL`: public backend URL used in trophy metadata.
- `TWITTER_VERIFICATION_SECRET`: salt for deterministic championship tweet codes.

The Rush contract addresses default to the current Base deployment, but can be overridden with:

- `AGENT_REGISTRY_ADDRESS`
- `ARENA_MANAGER_ADDRESS`
- `BATTLE_ENGINE_ADDRESS`
- `VRF_WRAPPER_ADDRESS`
- `CHAMPIONSHIP_TROPHY_ADDRESS`

`CORS_ORIGINS` accepts comma-separated origins and is merged with Rush defaults.

## Deploy

The included Dockerfile builds TypeScript, prunes dev dependencies, exposes port `3001`, and runs `npm run start`. `railway.toml` points the health check at `/health`.
