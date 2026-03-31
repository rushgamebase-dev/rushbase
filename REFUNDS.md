# Rush — Refund Ledger

## Recovery Contract
Address: `0x6cE3873e31Ab5440fA6AF1860F8E36110504c9C4` (Ethereum Mainnet)
Deployed at nonce 182 to match Base contract address.
Any future ETH sent to wrong chain → call `withdraw()` to recover to dd12.

## Completed Refunds

### Case 1 — 0x858E9483bd0cD7a53f78040A4342Dc79F239e930
- **Error:** Sent 0.012075 ETH on Ethereum mainnet instead of Base
- **Refund:** 0.012075 ETH on Base
- **Refund TX:** `0x027cee7f7c448783fab8945cc01dac1f905f8ee29a4d4c8a891b16dc67155802`
- **Status:** CLOSED
- **Notes:** User also had failed txs (gas lost) and buyout at same price. Both explained — no additional refund owed.

### Case 2 — 0x8c16A30c63964BbE29f83241a574CBeAae2Ba6DC
- **Error:** Sent 0.030188 ETH on Ethereum mainnet instead of Base
- **Refund:** Issued by team directly
- **Status:** CLOSED

### Case 3 — melloney.eth (0xA7cf9e40d95c5EB861460CD15a97bd552B481793)
- **Error:** Sent 2x 0.083318 ETH on Ethereum mainnet (total 0.166636 ETH)
- **Refund:** 0.166 ETH on Base
- **Refund TX:** `0x2d848aac84db53bf0fc9ee28f2a060555379e75db1cf90288fec40f7e2e24291`
- **Status:** CLOSED
- **Notes:** Active user with 3 tiles. Dust difference of 0.000636 ETH.

## Pending Refunds

None.

## ETH Mainnet Senders (from Etherscan)

All ETH sent to `0x6cE3...` on Ethereum mainnet was recovered on 2026-03-30.
Total recovered: 0.3685 ETH → sent to dd12 (`0xdd12D83786C2BAc7be3D59869834C23E91449A2D`)

| Sender | ETH | Refunded? |
|--------|-----|-----------|
| melloney.eth (`0xa7cf9e40...`) | 0.166 (2x 0.083) | YES — TX `0x2d848aac...` (0.166 ETH on Base) |
| `0x8c16A30c...` | 0.030 | YES |
| `0x927db60a...` | 0.035 | Check with team |
| boughttheblock.eth (`0x8198b5c4...`) | 0.048 | Check with team |
| `0x858E9483...` | 0.012 | YES |
| `0xd7ae8b35...` | 0.012 | Check with team |
| `0x511A00D9...` | 0.012 | Check with team |
| zirkut.eth (`0x71a7438c...`) | 0.021 | Check with team |
| lilhuhu Genesis Deployer (`0x7842c0b2...`) | 0.021 | Check with team |

## Notes
- Recovery contract is permanent on ETH mainnet. Future wrong-chain sends are recoverable via `withdraw()`.
- Gas fees on failed transactions are not refundable (consumed by network, not protocol).
- Buyout fees and appreciation taxes are protocol fees by design, not errors.
