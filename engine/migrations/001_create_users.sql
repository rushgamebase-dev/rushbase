-- Migration: Create users table
-- Identity: Ethereum wallet address (lowercased). Auth via SIWE.
-- Balances: stored in wei (uint256 ≤ 78 decimal digits).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Wallet identity (lowercased 0x-prefixed 40 hex chars)
    wallet_address VARCHAR(42) NOT NULL UNIQUE,
    username VARCHAR(100) UNIQUE,

    -- Off-chain ledger of on-chain ETH custody (all in wei).
    -- free = deposited + realized_pnl - withdrawn - locked_margin
    deposited_wei NUMERIC(78, 0) NOT NULL DEFAULT 0,
    withdrawn_wei NUMERIC(78, 0) NOT NULL DEFAULT 0,
    realized_pnl_wei NUMERIC(78, 0) NOT NULL DEFAULT 0,
    locked_margin_wei NUMERIC(78, 0) NOT NULL DEFAULT 0,

    -- Account status
    is_active BOOLEAN NOT NULL DEFAULT true,

    -- Per-user risk overrides (NULL = use global config)
    max_position_size_wei NUMERIC(78, 0),
    max_leverage INTEGER,

    -- Withdrawal nonce strictly greater than the on-chain consumed nonce.
    -- Engine increments before signing a new withdrawal authorization.
    next_withdraw_nonce BIGINT NOT NULL DEFAULT 1,

    -- Gamification stats
    total_trades INTEGER NOT NULL DEFAULT 0,
    total_wins INTEGER NOT NULL DEFAULT 0,
    total_losses INTEGER NOT NULL DEFAULT 0,
    current_win_streak INTEGER NOT NULL DEFAULT 0,
    best_win_streak INTEGER NOT NULL DEFAULT 0,

    -- Timestamps
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Constraints
    CONSTRAINT wallet_address_format CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
    CONSTRAINT non_negative_deposited CHECK (deposited_wei >= 0),
    CONSTRAINT non_negative_withdrawn CHECK (withdrawn_wei >= 0),
    CONSTRAINT non_negative_locked CHECK (locked_margin_wei >= 0),
    CONSTRAINT valid_leverage CHECK (max_leverage IS NULL OR (max_leverage >= 1 AND max_leverage <= 100)),
    CONSTRAINT positive_nonce CHECK (next_withdraw_nonce >= 1)
);

CREATE INDEX idx_users_wallet ON users(wallet_address);
CREATE INDEX idx_users_username ON users(username) WHERE username IS NOT NULL;
CREATE INDEX idx_users_created_at ON users(created_at);

-- updated_at trigger (used by other tables too)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
