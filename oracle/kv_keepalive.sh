#!/bin/bash
# Keepalive loop — POSTs oracle URL to Vercel KV every 10s.
# Needed because Vercel KV is memStore (volatile per instance) — one POST may
# land on instance A, but GET comes from instance B. This loop increases
# the probability that most instances eventually have the value.
URL="wss://oracle.rushgame.vip"
API="https://www.rushgame.vip/api/oracle-url"
KEY="novaengine-2026"
while true; do
  curl -s -X POST "$API" -H "Content-Type: application/json" -H "X-Api-Key: $KEY" -d "{\"url\":\"$URL\"}" > /dev/null 2>&1
  sleep 10
done
