#!/bin/bash
# Cron wrapper for proactive_bot.py.
# Usage: proactive_run.sh <daily|milestone>
#
# Cron lines (paste into `crontab -e`):
#   0 0 * * *  /home/lumen/.gemini/antigravity/scratch/rush/oracle/proactive_run.sh daily
#   0 * * * *  /home/lumen/.gemini/antigravity/scratch/rush/oracle/proactive_run.sh milestone

export PATH="/home/lumen/.foundry/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

set -a
source /home/lumen/.gemini/antigravity/scratch/rush/.env 2>/dev/null
set +a

LOG=/home/lumen/.gemini/antigravity/scratch/rush/oracle/logs/proactive_run.log
mkdir -p "$(dirname "$LOG")"

cd /home/lumen/.gemini/antigravity/scratch/rush/oracle
{
  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) mode=$1 ==="
  /home/lumen/miniconda3/bin/python3 proactive_bot.py "$1" 2>&1
  echo
} >> "$LOG"
