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

# ── Start cloudflared quick tunnel ──────────────────────────────────────────
TUNNEL_LOG="/tmp/rush_tunnel.log"
cloudflared tunnel --url "http://0.0.0.0:$WS_PORT" --no-chunked-encoding > "$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!
echo "[Launcher] Cloudflared PID: $TUNNEL_PID"

# ── Wait for tunnel URL (up to 30s) ─────────────────────────────────────────
echo "[Launcher] Waiting for tunnel URL..."
TUNNEL_URL=""
for i in $(seq 1 30); do
    TUNNEL_URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1)
    if [ -n "$TUNNEL_URL" ]; then
        break
    fi
    sleep 1
done

if [ -z "$TUNNEL_URL" ]; then
    echo "[ERROR] Failed to get tunnel URL after 30s"
    kill "$TUNNEL_PID" 2>/dev/null || true
    exit 1
fi

# Convert https to wss for WebSocket
WSS_URL="wss://$(echo "$TUNNEL_URL" | sed 's|https://||')"
echo "[Launcher] Tunnel URL: $WSS_URL"

# ── Register URL with frontend API ──────────────────────────────────────────
echo "[Launcher] Registering URL with frontend..."
curl -s -X POST \
    -H "Content-Type: application/json" \
    -H "X-Api-Key: $LEDGER_API_KEY" \
    -d "{\"url\":\"$WSS_URL\"}" \
    "$API_URL" || echo "[WARN] Could not register URL (API may be down)"
echo ""

# ── Graceful shutdown handler ────────────────────────────────────────────────
# Catches SIGTERM and SIGINT, kills both the tunnel and the watchdog cleanly.
WATCHDOG_PID=""

_cleanup() {
    echo ""
    echo "[Launcher] Shutdown signal received — stopping watchdog and tunnel..."

    if [ -n "$WATCHDOG_PID" ] && kill -0 "$WATCHDOG_PID" 2>/dev/null; then
        echo "[Launcher] Sending SIGTERM to watchdog (PID $WATCHDOG_PID)..."
        kill -TERM "$WATCHDOG_PID" 2>/dev/null || true
        # Wait up to 20s for watchdog to finish its graceful shutdown
        for i in $(seq 1 20); do
            kill -0 "$WATCHDOG_PID" 2>/dev/null || break
            sleep 1
        done
        # Force-kill if still alive
        kill -0 "$WATCHDOG_PID" 2>/dev/null && kill -KILL "$WATCHDOG_PID" 2>/dev/null || true
    fi

    echo "[Launcher] Stopping cloudflared tunnel (PID $TUNNEL_PID)..."
    kill "$TUNNEL_PID" 2>/dev/null || true

    echo "[Launcher] Done."
    exit 0
}

trap '_cleanup' TERM INT

# ── Start watchdog (which supervises round_manager_rush.py) ──────────────────
echo "[Launcher] Starting watchdog..."

# Detect stream-only mode: if --stream-only is in args, we run stream_server
# directly (watchdog does not supervise it, since it is intentionally finite).
STREAM_ONLY=false
for arg in "$@"; do
    if [ "$arg" = "--stream-only" ]; then
        STREAM_ONLY=true
        break
    fi
done

cd "$SCRIPT_DIR"

if $STREAM_ONLY; then
    # Parse --duration from args (default 300)
    DURATION="${DURATION:-300}"
    prev=""
    for arg in "$@"; do
        if [ "$prev" = "--duration" ]; then
            DURATION="$arg"
        fi
        prev="$arg"
    done

    echo "[Launcher] Mode: Stream Server only (${DURATION}s) — watchdog not used"
    python3 -u stream_server.py --camera peace-bridge --duration "$DURATION" --port "$WS_PORT" &
    WATCHDOG_PID=$!
else
    echo "[Launcher] Mode: Supervised Round Manager (watchdog.py)"
    python3 -u watchdog.py "$@" &
    WATCHDOG_PID=$!
fi

echo "[Launcher] Watchdog/server PID: $WATCHDOG_PID"

# ── Wait for the supervised process to finish (or for a signal) ──────────────
wait "$WATCHDOG_PID"
EXIT_CODE=$?

echo "[Launcher] Process exited with code $EXIT_CODE. Cleaning up..."
kill "$TUNNEL_PID" 2>/dev/null || true
exit "$EXIT_CODE"
