-- Migration: engine event log
-- A free-form audit trail for the touch-engine. The original `audit_log`
-- table (migration 004) shipped with a Postgres ENUM tied to the legacy
-- leverage-trading model (`POSITION_OPEN` etc.). Rather than mutate the
-- enum, we add a separate event table whose `event_type` is plain TEXT
-- so new event categories can be introduced without DDL.
--
-- Severity values: `info`, `warn`, `error`. Operations dashboards filter
-- on this column to triage quickly.

CREATE TABLE engine_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Actor (NULL for system-initiated events such as breaker trips).
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,

    -- Event taxonomy. Free-form, but follows `<DOMAIN>_<ACTION>` —
    -- e.g. `TOUCH_BET_OPENED`, `WITHDRAW_AUTHORIZED`, `BREAKER_TRIPPED`.
    event_type VARCHAR(64) NOT NULL,
    severity VARCHAR(16) NOT NULL DEFAULT 'info',

    -- Structured context: bet ids, amounts, quote nonces, error reasons.
    -- Indexed via a GIN index on `payload` so rare-key queries stay
    -- cheap as the table grows.
    payload JSONB,

    -- Caller IP (when known) for correlating with web-side logs.
    ip_address INET,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_engine_events_user_time
    ON engine_events(user_id, created_at DESC)
    WHERE user_id IS NOT NULL;

CREATE INDEX idx_engine_events_type_time
    ON engine_events(event_type, created_at DESC);

CREATE INDEX idx_engine_events_severity_time
    ON engine_events(severity, created_at DESC)
    WHERE severity IN ('warn', 'error');

CREATE INDEX idx_engine_events_payload ON engine_events USING GIN (payload);
