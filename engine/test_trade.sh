#!/bin/bash
# Test trading script

# Login
RESPONSE=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@test.com","password":"demo123456"}')

TOKEN=$(echo "$RESPONSE" | jq -r '.access_token')

echo "=== Logged in ==="
echo "Token: ${TOKEN:0:50}..."
echo ""

echo "=== Current Balance ==="
curl -s http://localhost:8080/api/v1/user/balance \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""

echo "=== Live Prices ==="
curl -s http://localhost:8080/api/v1/prices | jq -r '.prices[] | "  \(.symbol): $\(.price)"'
echo ""

echo "=== Opening LONG position on BTC (100x, $100 stake) ==="
curl -s -X POST http://localhost:8080/api/v1/trading/positions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSDT","side":"LONG","stake":"100","leverage":100}' | jq .
echo ""

echo "=== Updated Balance ==="
curl -s http://localhost:8080/api/v1/user/balance \
  -H "Authorization: Bearer $TOKEN" | jq .
