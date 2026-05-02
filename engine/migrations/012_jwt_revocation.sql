-- Migration 012: JWT revocation + per-user mass invalidation.
--
-- Two complementary mechanisms:
--
--   1. Per-token revoke list (`jwt_revocations`): a deny list of `jti`s.
--      Used for logout (a single session) and surgical revoke from
--      `/admin/users/:id/...`. Rows can be garbage-collected once
--      `expires_at` passes — no point keeping a deny entry past JWT TTL.
--
--   2. Per-user mass invalidation (`users.tokens_invalidated_before_ms`):
--      a UNIX-ms watermark. Every JWT whose `iat` is older is rejected.
--      Used when a user's whole device fleet must be kicked at once
--      (suspected wallet compromise, JWT secret rotation), without
--      enumerating every active session.
--
-- Both checks run inside the bearer validator; the DB hit is one extra
-- SELECT per authenticated request, made cheap by the active-status
-- cache covering most lookups.

CREATE TABLE jwt_revocations (
    jti UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- When the JWT itself expires. Once `NOW() > expires_at`, the row
    -- is no longer load-bearing — the JWT is rejected by signature/exp
    -- check anyway. Used by the GC sweep to keep the table compact.
    expires_at TIMESTAMPTZ NOT NULL,
    reason VARCHAR(64)
);

CREATE INDEX idx_jwt_revocations_user ON jwt_revocations(user_id);
CREATE INDEX idx_jwt_revocations_expires ON jwt_revocations(expires_at);

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS tokens_invalidated_before_ms BIGINT NOT NULL DEFAULT 0;
