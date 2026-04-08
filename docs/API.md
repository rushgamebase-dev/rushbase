# Rush Protocol -- API Reference

REST API powering the Rush frontend, hosted on Vercel. All endpoints at `https://rushgame.vip/api/`.

---

## Authentication

- Most endpoints are public (no auth required)
- Admin/write endpoints require API key authentication
- Rate limiting applied per-IP on most endpoints

---

## Endpoints

### GET /api/health

Health check for monitoring.

- **Auth**: None
- **Rate Limit**: None
- **Response**:
```json
{
  "status": "ok | degraded | down",
  "redis": true,
  "oracleUrl": "wss://...",
  "lastRound": { "timestamp": 1234, "count": 11, "ago": "2m ago" },
  "uptime": "5d 12h",
  "version": "1.0.0",
  "serverTime": 1234567890
}
```

---

### GET /api/stats

Platform-wide statistics.

- **Auth**: None
- **Rate Limit**: 20/min
- **Response**:
```json
{
  "totalVolume": 1234.56,
  "marketsResolved": 500,
  "uniqueBettors": 89,
  "feesDistributed": 61.2,
  "avgPoolSize": 2.47,
  "biggestRound": 15.3,
  "avgBettorsPerRound": 3.2,
  "volume24h": 45000
}
```

---

### GET /api/rounds/history

Recent round results.

- **Auth**: None
- **Rate Limit**: 20/min
- **Params**: `limit` (optional, max 100, default 20)
- **Response**:
```json
{
  "rounds": [
    {
      "roundNumber": 147,
      "marketAddress": "0x...",
      "result": "over",
      "actualCount": 11,
      "threshold": 8,
      "totalPool": "1500000000000000000",
      "resolvedAt": 1234567890
    }
  ]
}
```

---

### GET /api/ledger

List all market records.

- **Auth**: None
- **Rate Limit**: 10/min
- **Params**: `limit` (max 200, default 50), `offset` (pagination)
- **Response**:
```json
{
  "markets": ["...MarketRecord"],
  "total": 500
}
```

### POST /api/ledger

Create/update a market record (oracle use).

- **Auth**: API key required (oracle only)
- **Rate Limit**: 5/min
- **Body**: Full MarketRecord object
- **Response**: `{ "ok": true }`

---

### GET /api/ledger/[market]

Single market record by address.

- **Auth**: None
- **Rate Limit**: 10/min
- **Params**: `market` (URL param, Ethereum address)
- **Response**: Full MarketRecord object

---

### GET /api/evidence/[market]

Evidence frames and hashes for a specific market.

- **Auth**: None
- **Params**: `market` (URL param, Ethereum address)
- **Response**:
```json
{
  "market": "0x...",
  "evidence": {
    "frames": ["evidence/timestamp_30s.jpg"],
    "finalFrame": "evidence/timestamp_final.jpg",
    "frameHashes": ["sha256:abc..."]
  }
}
```
- Returns 404 if market not found

---

### GET /api/profile/[address]

User profile with betting history.

- **Auth**: None
- **Rate Limit**: 10/min
- **Params**: `address` (URL param, Ethereum address)
- **Response**:
```json
{
  "address": "0x...",
  "shortAddress": "0x1234...5678",
  "totalBets": 42,
  "wins": 20,
  "losses": 22,
  "winRate": 47.6,
  "totalPnl": 1.5,
  "tilesOwned": 2,
  "bets": [
    {
      "user": "0x...",
      "rangeIndex": 0,
      "rangeLabel": "Under 8",
      "amount": "1000000000000000000",
      "txHash": "0x...",
      "timestamp": 1234567890,
      "claimed": true,
      "claimAmount": "1800000000000000000",
      "marketAddress": "0x...",
      "marketDescription": "Vehicle count...",
      "threshold": 8,
      "actualCount": 11,
      "marketState": "RESOLVED",
      "resolvedAt": 1234567890
    }
  ]
}
```

---

### GET /api/ably-token

Generate Ably realtime token for frontend.

- **Auth**: None
- **Params**: `address` (optional, Ethereum address or "anon")
- **Response**:
```json
{
  "keyName": "...",
  "token": "...",
  "issued": 1234567890,
  "expires": 1234567890,
  "capability": { "rush:*": ["subscribe"] },
  "clientId": "0x...",
  "issuedAt": "2026-04-08T12:00:00Z",
  "expiresIn": 3600
}
```

---

### GET /api/oracle-url

Get current oracle WebSocket URL.

- **Auth**: None
- **Rate Limit**: 20/min
- **Response**: `{ "url": "wss://..." }`

### POST /api/oracle-url

Update oracle WebSocket URL (oracle use).

- **Auth**: API key required (admin only)
- **Rate Limit**: 5/min
- **Body**: `{ "url": "wss://..." }`
- **Response**: `{ "ok": true }`

---

### GET /api/chat/messages

Fetch chat messages.

- **Auth**: None
- **Rate Limit**: 120/min
- **Params**: `after` (optional, timestamp), `limit` (max 100, default 50)
- **Response**: `{ "messages": [{ "id", "username", "address", "color", "text", "timestamp" }] }`

### POST /api/chat/messages

Send a chat message.

- **Auth**: None
- **Rate Limit**: 5/min
- **Body**: `{ "text": "..." (max 200 chars), "address": "0x..." (optional) }`
- **Response**: `{ "ok": true, "message": {...} }`

---

### GET /api/chat/online

Online user count.

- **Auth**: None
- **Rate Limit**: 20/min
- **Params**: `heartbeat` (optional, Ethereum address to register presence)
- **Response**: `{ "online": 5 }`
- **Note**: Uses 30-second sliding window

---

### POST /api/admin/cancel-market

Admin market cancellation.

- **Auth**: API key required (admin only)
- **Body**: `{ "marketAddress": "0x..." (required), "txHash": "0x..." (optional), "cancelledBy": "0x..." (optional) }`
- **Response**: `{ "ok": true }`

---

### GET /api/audit

Audit event log.

- **Auth**: None
- **Params**: `market` (optional, filter by address), `limit` (max 200, default 50)
- **Response**: `{ "events": [...], "total": 100 }`

---

## WebSocket — Live Detection Stream

Real-time detection events via WebSocket. Connect to the URL returned by `/api/oracle-url`.

Events broadcast:

- `vehicle_counted` -- New vehicle crossing detected
- `state_update` -- Round state change (count, duration, camera info)
- `heartbeat` -- Keep-alive every 5 seconds

---

## Ably Channels

Real-time market events via Ably (token from `/api/ably-token`).

Channel: `rush:markets`

Events:

- `market_created` -- New market deployed
- `market_resolved` -- Market resolved with result
- `market_cancelled` -- Market cancelled

---

## Real-Time Services

| Service | Purpose |
|---------|---------|
| WebSocket | Live vehicle detection stream |
| Ably | Market lifecycle events (created, resolved, cancelled) |
