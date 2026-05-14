#!/bin/bash
# Long-running daemon wrapper for fee_bot.py listen mode.
# Run via systemd, tmux, or `nohup ... &`.
# On crash, exits — supervisor (systemd or auto-restart wrapper) should bring it back.

export PATH="/home/lumen/.foundry/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

set -a
source /home/lumen/.gemini/antigravity/scratch/rush/.env 2>/dev/null
set +a

cd /home/lumen/.gemini/antigravity/scratch/rush/oracle
exec /home/lumen/miniconda3/bin/python3 fee_bot.py listen
