#!/bin/bash
# Tunnel Watchdog — recreates tunnel automatically if it dies
ORACLE_PORT=9000
API_URL="https://www.rushgame.vip/api/oracle-url"
API_KEY="novaengine-2026"
TUNNEL_LOG="/tmp/cf_tunnel_wd.log"

start_tunnel() {
    pkill -f "cloudflared tunnel" 2>/dev/null
    sleep 2
    cloudflared tunnel --url http://localhost:$ORACLE_PORT > "$TUNNEL_LOG" 2>&1 &
    sleep 12
    URL=$(strings "$TUNNEL_LOG" 2>/dev/null | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | head -1)
    if [ -n "$URL" ]; then
        WSS="${URL/https/wss}"
        curl -s -X POST "$API_URL" -H "Content-Type: application/json" -H "X-Api-Key: $API_KEY" -d "{\"url\": \"$WSS\"}" > /dev/null
        echo "[$(date '+%H:%M:%S')] Tunnel UP: $WSS"
        echo "$WSS" > /tmp/tunnel_url.txt
    else
        echo "[$(date '+%H:%M:%S')] ERROR: no URL"
    fi
}

test_tunnel() {
    timeout 8 python3 -c "
import asyncio,websockets
async def t():
    async with websockets.connect('$(cat /tmp/tunnel_url.txt 2>/dev/null)',open_timeout=5) as ws:
        await asyncio.wait_for(ws.recv(),timeout=3)
        print('ok')
asyncio.run(t())
" 2>/dev/null | grep -q "ok"
}

echo "[$(date '+%H:%M:%S')] Tunnel watchdog started"
start_tunnel

while true; do
    sleep 30
    if ! test_tunnel; then
        echo "[$(date '+%H:%M:%S')] Tunnel dead — restarting"
        start_tunnel
    fi
done
