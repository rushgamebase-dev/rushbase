#!/bin/bash
# Periodic pokeTax on Mellozzy's 20 V1 tiles until all foreclose.
# Safe: only pokes tiles still owned by one of the 4 target wallets.
# Logs to oracle/logs/poke_mellozzy.log. Idempotent to re-run.

# Ensure cast is resolvable under cron's minimal PATH.
export PATH="/home/lumen/.foundry/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

set -a; source /home/lumen/.gemini/antigravity/scratch/rush/.env 2>/dev/null; set +a

V1=0x6cE3873e31Ab5440fA6AF1860F8E36110504c9C4
ZERO=0x0000000000000000000000000000000000000000
LOGDIR=/home/lumen/.gemini/antigravity/scratch/rush/oracle/logs
LOG="$LOGDIR/poke_mellozzy.log"
mkdir -p "$LOGDIR"

# The 4 sybil wallets (lowercased)
W1=0x1d652df2a24cf2c6c6b7f3e71fb95b094500b85a
W2=0x0291074cc5a1dcb60fedfafacc00773909a8121c
W3=0x0f83fb4cfe238b83a2a3f8bbeded31672c718460
W4=0x3d4eefff09f3b0ab6bf5c77d4d29d320a593144c

# Contract indexes of the 20 tiles (UX - 1)
TILES=(63 64 72 73 95 57 75 85 91 97 2 9 20 21 26 4 22 60 62 96)

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "$(ts) | $*" >> "$LOG"; }

log "=== run start ==="

POKED=0
FORECLOSED=0
SKIPPED_OWNER=0
SKIPPED_ALREADY=0
FAILED=0

for IDX in "${TILES[@]}"; do
  RAW=$(cast call --rpc-url "$RPC_URL" $V1 \
    "getTile(uint8)((address,uint80,uint96,uint40,uint40))" $IDX 2>/dev/null)
  OWNER=$(echo "$RAW" | sed 's/[()]//g' | awk -F, '{print $1}' | xargs)
  OWNER_LC="${OWNER,,}"

  if [ "$OWNER_LC" = "$ZERO" ]; then
    log "idx $IDX | already foreclosed (skip)"
    SKIPPED_ALREADY=$((SKIPPED_ALREADY+1))
    continue
  fi

  case "$OWNER_LC" in
    "$W1"|"$W2"|"$W3"|"$W4") ;;
    *)
      log "idx $IDX | owner $OWNER_LC not in target set (skip)"
      SKIPPED_OWNER=$((SKIPPED_OWNER+1))
      continue
      ;;
  esac

  # Pre-poke deposit snapshot
  DEP_BEFORE=$(echo "$RAW" | sed 's/[()]//g' | awk -F, '{print $3}' | sed 's/ \[.*\]//' | xargs)

  # Poke with up to 3 retries (round_manager may collide on nonce)
  for TRY in 1 2 3; do
    OUT=$(cast send --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" \
      $V1 "pokeTax(uint8)" $IDX 2>&1)
    if echo "$OUT" | grep -q 'status.*1'; then
      TX=$(echo "$OUT" | grep -oE 'transactionHash\s+0x[a-f0-9]+' | awk '{print $2}')
      # Re-read owner to detect foreclosure triggered by this poke
      OWNER_AFTER=$(cast call --rpc-url "$RPC_URL" $V1 \
        "getTile(uint8)((address,uint80,uint96,uint40,uint40))" $IDX 2>/dev/null \
        | sed 's/[()]//g' | awk -F, '{print $1}' | xargs)
      if [ "${OWNER_AFTER,,}" = "$ZERO" ]; then
        log "idx $IDX | FORECLOSED via poke | tx $TX"
        FORECLOSED=$((FORECLOSED+1))
      else
        log "idx $IDX | poked (still held) | tx $TX | dep_before=$DEP_BEFORE"
        POKED=$((POKED+1))
      fi
      break
    fi
    if [ $TRY -eq 3 ]; then
      ERR=$(echo "$OUT" | head -1 | cut -c1-140)
      log "idx $IDX | FAILED after 3 tries | $ERR"
      FAILED=$((FAILED+1))
    else
      sleep 7
    fi
  done

  sleep 3
done

log "summary | poked=$POKED foreclosed=$FORECLOSED already=$SKIPPED_ALREADY non_target=$SKIPPED_OWNER failed=$FAILED"
log "=== run end ==="
