# Rush Protocol -- Deployment Guide

## Prerequisites

- Node.js 18+
- Python 3.10+ with CUDA GPU
- Foundry (for contracts)
- Vercel account (for frontend)
- Cloudflare account (for tunnels)

## Smart Contracts

```bash
cd contracts
forge install
forge build
forge test

# Deploy (requires funded wallet on Base)
forge script script/Deploy.s.sol \
  --broadcast \
  --rpc-url <base_rpc_url> \
  --verify \
  --etherscan-api-key <basescan_key>
```

After deployment:

1. Verify all contracts on Basescan
2. Update addresses in `frontend/lib/contracts.ts`
3. Update `.env` with new factory address

## Frontend

```bash
cd frontend
npm install
npm run build      # Verify build succeeds
```

Deployed on Vercel:

1. Connect repo to Vercel
2. Set environment variables in Vercel dashboard
3. Push to main to trigger auto-deploy

Required environment variables:

- `NEXT_PUBLIC_CONTRACT_ADDRESS` -- Factory contract address
- Additional server-side variables for API functionality (see team)

## Oracle

```bash
cd oracle
pip install -r requirements.txt
```

Required:

- Oracle wallet funded with ETH on Base (for gas)
- GPU with CUDA for YOLOv8x inference
- Stable internet for camera streams
- Cloudflare tunnel for WebSocket access

Environment variables needed in `.env`:

- Contract addresses
- RPC endpoint
- Oracle wallet key

The oracle runs as a supervised process. See `oracle/README.md` for details.

## Camera Calibration

Camera setup requires:

1. Define counting line(s) for the camera view
2. Configure detection zones (ROI)
3. Test detection accuracy before enabling

Calibration tools are available in `frontend/public/` for line and ROI setup.

## Monitoring

- `/api/health` -- System health check (Redis, oracle status, last round)
- `/api/stats` -- Platform statistics
- `/api/audit` -- Audit event log

## Checklist

- [ ] Contracts deployed and verified on Basescan
- [ ] Frontend deployed on Vercel with correct env vars
- [ ] Oracle running with funded wallet
- [ ] Cloudflare tunnel active
- [ ] Health check returning "ok"
- [ ] First test round completed successfully
