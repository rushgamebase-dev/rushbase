#!/bin/bash
# Close position script

# Login
RESPONSE=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@test.com","password":"demo123456"}')

TOKEN=$(echo "$RESPONSE" | jq -r '.access_token')

echo "=== Current Positions ==="
POSITIONS=$(curl -s http://localhost:8080/api/v1/trading/positions \
  -H "Authorization: Bearer $TOKEN")
echo "$POSITIONS" | jq .

# Get first position ID
POSITION_ID=$(echo "$POSITIONS" | jq -r '.positions[0].position.id // empty')

if [ -n "$POSITION_ID" ]; then
    echo ""
    echo "=== Live Prices ==="
    curl -s http://localhost:8080/api/v1/prices | jq -r '.prices[] | "  \(.symbol): $\(.price)"'

    echo ""
    echo "=== Closing position: $POSITION_ID ==="
    curl -s -X DELETE "http://localhost:8080/api/v1/trading/positions/$POSITION_ID" \
      -H "Authorization: Bearer $TOKEN" | jq .

    echo ""
    echo "=== Final Balance ==="
    curl -s http://localhost:8080/api/v1/user/balance \
      -H "Authorization: Bearer $TOKEN" | jq .
else
    echo "No open positions to close"
fi
