-- Migration 011: admin role + signer key audit + drop legacy audit_log.
--
--  1. `users.is_admin` — gates `/admin/*` endpoints. Default false; an
--     existing admin (or psql) flips the bit on someone trusted before
--     they can manage the engine. Bootstrap by setting one row directly:
--
--         UPDATE users SET is_admin = true WHERE id = '...';
--
--  2. `signer_audit` — small per-rotation table so ops can see how old
--     the active withdraw-signer key is. Engine writes one row at boot
--     when it loads the signer; rotations append.
--
--  3. The original `audit_log` table (migration 004) is leverage-era.
--     Replaced by `engine_events` (migration 010). Drop it now that
--     no Rust code references it.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_users_admin
    ON users(is_admin) WHERE is_admin = true;

CREATE TABLE IF NOT EXISTS signer_audit (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    signer_address VARCHAR(42) NOT NULL,
    -- 'boot' = engine loaded an existing key, 'rotation' = key changed
    -- (admin proposed + activated on the vault contract).
    activation_kind VARCHAR(16) NOT NULL,
    activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Optional context: who proposed (user_id), prior signer.
    actor_user_id UUID REFERENCES users(id),
    previous_signer VARCHAR(42)
);

CREATE INDEX IF NOT EXISTS idx_signer_audit_activated
    ON signer_audit(activated_at DESC);

-- Drop the orphan legacy table. The ENUM type goes with it.
DROP TABLE IF EXISTS audit_log;
DROP TYPE IF EXISTS audit_action;
