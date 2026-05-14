#!/bin/bash
# Cron-callable wrapper for fee_bot.py distribute mode.
# Run every 30 minutes. Reads keys + Telegram config from .env.
# Idempotent: skips silently when accumulated fees < threshold.

export PATH="/home/lumen/.foundry/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

set -a
source /home/lumen/.gemini/antigravity/scratch/rush/.env 2>/dev/null
set +a

LOG=/home/lumen/.gemini/antigravity/scratch/rush/oracle/logs/fee_distribute.log
mkdir -p "$(dirname "$LOG")"

cd /home/lumen/.gemini/antigravity/scratch/rush/oracle
{
  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
  /home/lumen/miniconda3/bin/python3 fee_bot.py distribute 2>&1
  echo
} >> "$LOG"
