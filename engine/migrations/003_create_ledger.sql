-- Migration: Create ledger table
-- Immutable transaction log for every wei movement on a user's account.
-- Auth uses SIWE + access JWT only (no refresh tokens).

CREATE TYPE transaction_type AS ENUM (
    'DEPOSIT',           -- on-chain Deposited event observed
    'WITHDRAWAL',        -- on-chain Withdrawn event observed
    'STAKE_LOCK',        -- bet placed: stake moved to locked
    'STAKE_RELEASE',     -- bet resolved: stake unlocked (regardless of outcome)
    'BET_PAYOUT',        -- positive realized PnL from a winning bet
    'BET_LOSS',          -- negative realized PnL from a losing bet
    'HOUSE_EDGE_FEE',    -- portion of stake captured as house edge on win
    'ADJUSTMENT'
);

CREATE TABLE ledger (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    tx_type transaction_type NOT NULL,
    -- Signed delta in wei. May be negative (e.g. MARGIN_LOCK, LIQUIDATION_LOSS).
    amount_wei NUMERIC(78, 0) NOT NULL,

    -- Snapshot of free balance for audit (deposited + realized_pnl - withdrawn - locked).
    free_balance_before_wei NUMERIC(78, 0) NOT NULL,
    free_balance_after_wei NUMERIC(78, 0) NOT NULL,

    -- Reference to the entity that produced this entry.
    reference_id UUID,
    reference_type VARCHAR(50),

    -- Optional on-chain proof for DEPOSIT / WITHDRAWAL.
    chain_tx_hash VARCHAR(66),
    chain_log_index INTEGER,
    chain_block_number BIGINT,

    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ledger_user_id ON ledger(user_id);
CREATE INDEX idx_ledger_tx_type ON ledger(tx_type);
CREATE INDEX idx_ledger_reference ON ledger(reference_id);
CREATE INDEX idx_ledger_created_at ON ledger(created_at DESC);
CREATE INDEX idx_ledger_user_created ON ledger(user_id, created_at DESC);

-- A given on-chain log can produce at most one ledger entry (idempotency).
CREATE UNIQUE INDEX idx_ledger_chain_log
    ON ledger(chain_tx_hash, chain_log_index)
    WHERE chain_tx_hash IS NOT NULL;
