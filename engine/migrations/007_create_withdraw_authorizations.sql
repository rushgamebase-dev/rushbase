-- Migration: Withdrawal authorizations signed by the engine.
-- The engine signs (chainId, vault, user, amount, nonce); the user submits
-- the signature to TradingVault.withdraw(...). Status flips to SPENT once
-- the on-chain Withdrawn event is observed (matched by nonce).
-- Authorizations expire if not consumed within `expires_at`.

CREATE TYPE withdraw_auth_status AS ENUM (
    'SIGNED',
    'SPENT',
    'EXPIRED',
    'CANCELLED'
);

CREATE TABLE withdraw_authorizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    amount_wei NUMERIC(78, 0) NOT NULL,
    nonce BIGINT NOT NULL,

    -- 65-byte ECDSA signature, hex-encoded (0x-prefixed).
    signature VARCHAR(132) NOT NULL,
    signer_address VARCHAR(42) NOT NULL,

    -- Snapshot of free balance at signing time (audit).
    free_balance_at_sign_wei NUMERIC(78, 0) NOT NULL,

    status withdraw_auth_status NOT NULL DEFAULT 'SIGNED',
    expires_at TIMESTAMPTZ NOT NULL,

    -- Set when the on-chain Withdrawn event with matching nonce is observed.
    spent_tx_hash VARCHAR(66),
    spent_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT positive_amount CHECK (amount_wei > 0),
    CONSTRAINT positive_nonce CHECK (nonce >= 1),
    CONSTRAINT signer_format CHECK (signer_address ~ '^0x[0-9a-f]{40}$')
);

-- A user has at most one in-flight authorization per nonce.
CREATE UNIQUE INDEX idx_withdraw_auth_user_nonce
    ON withdraw_authorizations(user_id, nonce);

CREATE INDEX idx_withdraw_auth_status ON withdraw_authorizations(status);
CREATE INDEX idx_withdraw_auth_expires ON withdraw_authorizations(expires_at)
    WHERE status = 'SIGNED';
