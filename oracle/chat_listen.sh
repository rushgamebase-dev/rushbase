#!/bin/bash
# Long-running daemon for chat_bot.py — RUSH personality layer.
# Polls Telegram getUpdates, decides when to respond, calls GPT with tools.
# Run via tmux / nohup / systemd. Logs to oracle/logs/chat_bot.log.

export PATH="/home/lumen/.foundry/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

set -a
source /home/lumen/.gemini/antigravity/scratch/rush/.env 2>/dev/null
set +a

cd /home/lumen/.gemini/antigravity/scratch/rush/oracle
exec /home/lumen/miniconda3/bin/python3 chat_bot.py
