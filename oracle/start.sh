#!/bin/bash
# ─── Rush Oracle Launcher ────────────────────────────────────────────────────
# Starts: cloudflared tunnel + watchdog.py (which supervises round_manager_rush.py)
#
# Usage:
#   ./start.sh                          # infinite rounds (supervised)
#   ./start.sh --stream-only            # stream server only
#   ./start.sh --stream-only --duration 300
#   ./start.sh --rounds 3               # finite run (supervised, 3 rounds)
#
# Environment variables:
#   WS_PORT           WebSocket port (default: 8765)
#   API_URL           Oracle URL registration endpoint
#   LEDGER_API_KEY    API key for the registration call
#   ALERT_WEBHOOK_URL Discord/Telegram webhook for crash alerts (optional)
#   ORACLE_MODE       "rounds" (default) | "stream-only"
#   PRIVATE_KEY       Oracle wallet key (required)
#   RPC_URL           Base RPC endpoint
#   FACTORY_ADDRESS   MarketFactory contract address
# ──────────────────────────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Load .env from project root (auto-export all vars) ─────────────────────
if [ -f "$ROOT_DIR/.env" ]; then
    set -a
    source "$ROOT_DIR/.env"
    set +a
    echo "[Launcher] Loaded .env from $ROOT_DIR/.env"
fi

# Ensure FACTORY_ADDRESS is set (not in .env by default)
export FACTORY_ADDRESS="${FACTORY_ADDRESS:-0x5b04F3DFaE780A7e109066E754d27f491Af55Af9}"

WS_PORT="${WS_PORT:-8765}"
API_URL="${API_URL:-https://www.rushgame.vip/api/oracle-url}"
LEDGER_API_KEY="${LEDGER_API_KEY:-}"

# ── Clean slate: kill ALL previous oracle instances ─────────────────────────
echo "[Launcher] Cleaning previous instances..."
pkill -f "round_manager_rush.py" 2>/dev/null || true
pkill -f "watchdog.py --rounds" 2>/dev/null || true
pkill -f "stream_server.py" 2>/dev/null || true
pkill -f "cloudflared tunnel" 2>/dev/null || true
pkill -f "ngrok http" 2>/dev/null || true
kill $(lsof -ti :"$WS_PORT") 2>/dev/null || true
sleep 2
# Force-kill any survivors
pkill -9 -f "round_manager_rush.py" 2>/dev/null || true
pkill -9 -f "watchdog.py --rounds" 2>/dev/null || true
# Remove stale lockfile
rm -f /tmp/rush_oracle.lock 2>/dev/null || true

echo "═══════════════════════════════════════════════════"
echo "  Rush Oracle Launcher"
echo "  WebSocket port: $WS_PORT"
echo "═══════════════════════════════════════════════════"

# ── Register ngrok URL with frontend (ngrok managed by separate systemd service) ──
echo "[Launcher] Fetching ngrok tunnel URL..."
TUNNEL_URL=""
for i in $(seq 1 30); do
    TUNNEL_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | python3 -c "import json,sys; [print(t['public_url']) for t in json.load(sys.stdin).get('tunnels',[])]" 2>/dev/null | head -1)
    if [ -n "$TUNNEL_URL" ]; then
        break
    fi
    sleep 1
done

if [ -z "$TUNNEL_URL" ]; then
    echo "[WARN] No ngrok tunnel found — oracle will run but WS won't be accessible externally"
fi

if [ -n "$TUNNEL_URL" ]; then
    WSS_URL="wss://$(echo "$TUNNEL_URL" | sed 's|https://||')"
    echo "[Launcher] Tunnel URL: $WSS_URL"
    echo "[Launcher] Registering URL with frontend..."
    curl -s -X POST \
        -H "Content-Type: application/json" \
        -H "X-Api-Key: $LEDGER_API_KEY" \
        -d "{\"url\":\"$WSS_URL\"}" \
    "$API_URL" || echo "[WARN] Could not register URL (API may be down)"
    echo ""
fi

# ── Graceful shutdown handler ────────────────────────────────────────────────
# Catches SIGTERM and SIGINT, kills both the tunnel and the watchdog cleanly.
WATCHDOG_PID=""
STREAM_PID=""

_cleanup() {
    echo ""
    echo "[Launcher] Shutdown signal received — stopping all services..."

    # Stop watchdog first (it controls rounds)
    if [ -n "$WATCHDOG_PID" ] && kill -0 "$WATCHDOG_PID" 2>/dev/null; then
        echo "[Launcher] Stopping watchdog (PID $WATCHDOG_PID)..."
        kill -TERM "$WATCHDOG_PID" 2>/dev/null || true
        for i in $(seq 1 15); do
            kill -0 "$WATCHDOG_PID" 2>/dev/null || break
            sleep 1
        done
        kill -0 "$WATCHDOG_PID" 2>/dev/null && kill -KILL "$WATCHDOG_PID" 2>/dev/null || true
    fi

    # Then stop stream server
    if [ -n "$STREAM_PID" ] && kill -0 "$STREAM_PID" 2>/dev/null; then
        echo "[Launcher] Stopping stream server (PID $STREAM_PID)..."
        kill -TERM "$STREAM_PID" 2>/dev/null || true
        sleep 2
        kill -0 "$STREAM_PID" 2>/dev/null && kill -KILL "$STREAM_PID" 2>/dev/null || true
    fi

    echo "[Launcher] Done."
    exit 0
}

trap '_cleanup' TERM INT

# ── Start persistent stream server FIRST ──────────────────────────────────────
# Stream server runs continuously — never exits between rounds.
# Round manager connects to it via WS and controls counting.
echo "[Launcher] Starting persistent stream server..."

cd "$SCRIPT_DIR"

CAMERA="${CAMERA:-peace-bridge}"
python3 -u stream_server.py --camera "$CAMERA" --port "$WS_PORT" &
STREAM_PID=$!
echo "[Launcher] Stream server PID: $STREAM_PID (camera: $CAMERA, port: $WS_PORT)"

# Wait for stream server to be ready (YOLO model load + HLS connect)
echo "[Launcher] Waiting for stream server to be ready..."
for i in $(seq 1 30); do
    if python3 -c "
import asyncio, websockets
async def t():
    async with websockets.connect('ws://localhost:$WS_PORT', open_timeout=2) as ws:
        await asyncio.wait_for(ws.recv(), timeout=2)
asyncio.run(t())
" 2>/dev/null; then
        echo "[Launcher] Stream server ready!"
        break
    fi
    sleep 2
done

# ── Start watchdog (which supervises round_manager_rush.py) ──────────────────
echo "[Launcher] Starting watchdog (round manager)..."

# Detect stream-only mode
STREAM_ONLY=false
for arg in "$@"; do
    if [ "$arg" = "--stream-only" ]; then
        STREAM_ONLY=true
        break
    fi
done

if $STREAM_ONLY; then
    echo "[Launcher] Mode: Stream Server only — watchdog not used"
    wait "$STREAM_PID"
else
    echo "[Launcher] Mode: Supervised Round Manager (watchdog.py)"
    python3 -u watchdog.py "$@" &
    WATCHDOG_PID=$!
    echo "[Launcher] Watchdog PID: $WATCHDOG_PID"

    # Monitor loop — restart stream_server if it dies, exit if watchdog dies
    while true; do
        if ! kill -0 "$WATCHDOG_PID" 2>/dev/null; then
            echo "[Launcher] Watchdog died — shutting down"
            kill "$STREAM_PID" 2>/dev/null
            exit 1
        fi
        if ! kill -0 "$STREAM_PID" 2>/dev/null; then
            echo "[Launcher] Stream server died — restarting in 3s"
            sleep 3
            python3 -u stream_server.py --camera "$CAMERA" --port "$WS_PORT" &
            STREAM_PID=$!
            echo "[Launcher] Stream server restarted: PID $STREAM_PID"
        fi
        sleep 5
    done
fi

# Only reached in stream-only mode
echo "[Launcher] Watchdog/server PID: $WATCHDOG_PID"
wait "$WATCHDOG_PID"
EXIT_CODE=$?

echo "[Launcher] Process exited with code $EXIT_CODE. Cleaning up..."
kill "$TUNNEL_PID" 2>/dev/null || true
exit "$EXIT_CODE"
