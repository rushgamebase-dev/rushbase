-- Migration: Track on-chain listener progress.
-- Singleton row; engine reads/writes `last_processed_block` to resume from
-- where it left off after restarts and to enforce N-confirmation safety.

CREATE TABLE chain_state (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    chain_id BIGINT NOT NULL,
    vault_address VARCHAR(42) NOT NULL,

    last_processed_block BIGINT NOT NULL DEFAULT 0,
    last_processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Engine pauses new trades if true. Set when oracle sanity check trips.
    safe_mode BOOLEAN NOT NULL DEFAULT false,
    safe_mode_reason TEXT,
    safe_mode_triggered_at TIMESTAMPTZ,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT vault_address_format CHECK (vault_address ~ '^0x[0-9a-f]{40}$')
);

CREATE UNIQUE INDEX idx_chain_state_singleton
    ON chain_state(chain_id, vault_address);

CREATE TRIGGER update_chain_state_updated_at
    BEFORE UPDATE ON chain_state
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
