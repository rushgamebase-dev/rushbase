# Rush Oracle -- AI Vehicle Detection & Market Settlement

## Overview

The oracle observes live traffic cameras using computer vision, counts vehicles in real-time, and settles prediction markets on Base.

## Components

- **Detection Engine** -- Proprietary AI pipeline for real-time vehicle detection and tracking
- **Market Manager** -- Creates, monitors, and resolves markets on-chain
- **Process Supervisor** -- Keeps the system running with automatic recovery

## Round Flow

1. Create market on-chain
2. Betting window (2:30)
3. Lock market
4. Counting window (2:30) -- evidence frames captured
5. Resolve market with final count
6. Auto-distribute winnings

## Requirements

- Python 3.10+
- CUDA-capable GPU (for AI inference)
- ffmpeg
- yt-dlp (for YouTube camera sources)

## Quick Start

```bash
pip install -r requirements.txt
python3 watchdog.py    # Production (supervised)
```

## Evidence

Every round produces timestamped evidence frames with SHA-256 hashes. Evidence is posted to the platform API and viewable at `/api/evidence/[market]`.

## Cameras

Multiple cameras supported worldwide. Camera configuration is managed internally. Currently active: Konya, Turkey.

## On-Chain Actions

All market actions require the oracle wallet:

- `createMarket()` -- Deploy new prediction market
- `lockMarket()` -- Close betting window
- `resolveMarket(count)` -- Submit final count and determine winners
- `distributeAll()` -- Auto-pay all winners
- `cancelMarket()` / `refundAll()` -- Cancel and refund if needed

## Security

- Oracle wallet is the sole market operator
- Multi-oracle consensus infrastructure exists on-chain for future activation
- Evidence frames provide transparency for every round
