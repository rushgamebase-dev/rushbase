-- Migration: SIWE login nonces.
-- Engine issues a fresh nonce per (wallet, ip), the user signs a SIWE
-- message containing it, and the engine verifies + consumes the nonce.

CREATE TABLE siwe_nonces (
    nonce VARCHAR(64) PRIMARY KEY,
    wallet_address VARCHAR(42) NOT NULL,
    ip_address INET,
    consumed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT wallet_format CHECK (wallet_address ~ '^0x[0-9a-f]{40}$')
);

CREATE INDEX idx_siwe_wallet ON siwe_nonces(wallet_address);
CREATE INDEX idx_siwe_expires ON siwe_nonces(expires_at)
    WHERE consumed_at IS NULL;
