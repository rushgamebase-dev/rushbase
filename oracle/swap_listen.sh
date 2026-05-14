#!/bin/bash
# Daemon wrapper for swap_listener.py.
# Run via: nohup oracle/swap_listen.sh > oracle/logs/swap_listener.log 2>&1 &

export PATH="/home/lumen/.foundry/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

set -a
source /home/lumen/.gemini/antigravity/scratch/rush/.env 2>/dev/null
set +a

cd /home/lumen/.gemini/antigravity/scratch/rush/oracle
exec /home/lumen/miniconda3/bin/python3 swap_listener.py
