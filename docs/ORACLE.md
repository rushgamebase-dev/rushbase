# Rush Oracle — AI-Powered Vehicle Detection

## Overview

The Rush Oracle is a proprietary AI system that observes live traffic cameras, counts vehicles in real-time, and settles prediction markets on-chain. Every round result is backed by evidence frames with SHA-256 hashes for transparency.

## How It Works

```
Live Traffic Camera
        |
        v
  AI Detection Engine
  (Proprietary Vision System)
        |
        v
  Vehicle Counting
  (real-time tracking)
        |
        v
  On-Chain Settlement
  (create → lock → resolve → distribute)
```

1. **Watch** — The oracle connects to a live traffic camera stream
2. **Detect** — AI identifies and tracks vehicles in real-time
3. **Count** — The system counts vehicles with built-in deduplication to prevent double-counting
4. **Settle** — The final count is submitted on-chain, the market resolves, and winners are paid automatically

## Round Lifecycle

Each round lasts **5 minutes** (300 seconds):

| Phase | Duration | What Happens |
|-------|----------|-------------|
| **Betting** | 2:30 | Market open, users place bets, live count visible |
| **Locked** | — | `lockMarket()` called, no more bets |
| **Counting** | 2:30 | Oracle continues counting, evidence captured |
| **Resolution** | — | `resolveMarket(count)` called, winners paid via `distributeAll()` |

The oracle broadcasts the live vehicle count via WebSocket so users can watch the action in real-time.

## Evidence System

Every round produces verifiable evidence:

- **Snapshot frames** captured every 30 seconds during counting
- **Final frame** captured at round end
- **SHA-256 hash** for every frame
- Evidence posted to the `/api/evidence/[market]` endpoint

```json
{
  "count": 11,
  "duration": 150,
  "marketAddress": "0x...",
  "roundId": 147,
  "evidence": {
    "frames": ["evidence/timestamp_30s.jpg"],
    "final_frame": "evidence/timestamp_final.jpg",
    "frame_hashes": ["sha256:abc..."]
  }
}
```

Anyone can verify that the evidence frames match their hashes.

## Camera System

The oracle supports multiple live cameras worldwide. Cameras rotate between rounds when multiple are enabled.

**Current Active Camera**: Konya, Turkey — 1080p HD traffic camera

**Available Cameras**:

| Location | Type | Status |
|----------|------|--------|
| Konya, Turkey | HLS | Active |
| Serpong, Indonesia | HLS | Standby |
| Netherlands | YouTube | Standby |
| Fort Erie, USA/Canada | YouTube | Standby |
| Yangju, Korea | HLS | Standby |
| Pekanbaru, Indonesia | HLS | Standby |
| Korea (multi-class) | HLS | Standby |

New cameras can be added to expand geographic coverage and market variety.

## Adaptive Threshold

The betting threshold (Over/Under line) adjusts based on recent round history. This prevents markets from becoming too predictable and keeps the odds balanced.

## On-Chain Settlement

All market actions are verifiable on-chain:

| Action | Contract Function | Who |
|--------|------------------|-----|
| Create market | `createMarket()` | Oracle |
| Lock betting | `lockMarket()` | Oracle |
| Resolve with count | `resolveMarket(actualCount)` | Oracle |
| Pay winners | `distributeAll()` | Oracle (auto) |
| Cancel round | `cancelMarket()` → `refundAll()` | Oracle |

Oracle wallet: [`0x4c385830c2E241EfeEd070Eb92606B6AedeDA277`](https://basescan.org/address/0x4c385830c2E241EfeEd070Eb92606B6AedeDA277)

## Transparency & Trust

- **Open source contracts** — All market logic is verified on Basescan
- **Evidence frames** — Every round has timestamped snapshots with cryptographic hashes
- **Single oracle** — Currently one oracle operator; multi-oracle consensus infrastructure (OracleRegistry, ConsensusEngine, DataAttestation) is deployed and ready for activation
- **No house edge** — The oracle cannot influence payouts; it only submits the vehicle count
