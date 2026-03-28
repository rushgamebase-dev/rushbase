#!/bin/bash
# ─── Rush Oracle Launcher ────────────────────────────────────────────────────
# Starts: cloudflared tunnel + stream_server/round_manager
# Auto-registers the tunnel URL with the frontend API so no redeploy needed.
#
# Usage:
#   ./start.sh                    # stream only (5 min test)
#   ./start.sh --rounds 0         # full round manager (infinite)
#   ./start.sh --duration 120     # stream only, 2 min
# ──────────────────────────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WS_PORT="${WS_PORT:-8765}"
API_URL="${API_URL:-https://www.rushgame.vip/api/oracle-url}"
LEDGER_API_KEY="${LEDGER_API_KEY:-}"

# Kill anything on the port
kill $(lsof -ti :"$WS_PORT") 2>/dev/null || true
pkill -f "cloudflared tunnel" 2>/dev/null || true
sleep 1

echo "═══════════════════════════════════════════════════"
echo "  Rush Oracle Launcher"
echo "  WebSocket port: $WS_PORT"
echo "═══════════════════════════════════════════════════"

# ── Start cloudflared quick tunnel ──────────────────────────────────────────
TUNNEL_LOG="/tmp/rush_tunnel.log"
cloudflared tunnel --url "http://localhost:$WS_PORT" > "$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!
echo "[Launcher] Cloudflared PID: $TUNNEL_PID"

# Wait for tunnel URL
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
    kill $TUNNEL_PID 2>/dev/null
    exit 1
fi

# Convert https to wss for WebSocket
WSS_URL="wss://$(echo "$TUNNEL_URL" | sed 's|https://||')"
echo "[Launcher] Tunnel URL: $WSS_URL"

# ── Register URL with frontend API ─────────────────────────────────────────
echo "[Launcher] Registering URL with frontend..."
curl -s -X POST \
    -H "Content-Type: application/json" \
    -H "X-Api-Key: $LEDGER_API_KEY" \
    -d "{\"url\":\"$WSS_URL\"}" \
    "$API_URL" || echo "[WARN] Could not register URL (API may be down)"
echo ""

# ── Start oracle ────────────────────────────────────────────────────────────
echo "[Launcher] Starting oracle..."

if [[ "$*" == *"--rounds"* ]]; then
    # Full round manager mode
    echo "[Launcher] Mode: Round Manager"
    cd "$SCRIPT_DIR"
    python3 -u round_manager_rush.py "$@"
else
    # Stream server only
    DURATION="${DURATION:-300}"
    # Parse --duration from args
    for arg in "$@"; do
        if [[ "$prev" == "--duration" ]]; then
            DURATION="$arg"
        fi
        prev="$arg"
    done

    echo "[Launcher] Mode: Stream Server (${DURATION}s)"
    cd "$SCRIPT_DIR"
    python3 -u stream_server.py --camera peace-bridge --duration "$DURATION" --port "$WS_PORT" "$@"
fi

# ── Cleanup ─────────────────────────────────────────────────────────────────
echo "[Launcher] Oracle stopped. Cleaning up..."
kill $TUNNEL_PID 2>/dev/null || true
