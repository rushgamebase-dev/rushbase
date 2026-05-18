-- Migration: Tap Trading shadow/canary bets
--
-- Shadow bets are operator-only dry runs. They price a cell with the
-- production multiplier engine and resolve against the same market/index
-- history as real bets, but never lock user funds, reserve exposure, or
-- write ledger rows. Use this while Tap Trading is paused to verify odds
-- and realised outcomes before re-opening public entries.

CREATE TABLE tap_shadow_bets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    symbol VARCHAR(32) NOT NULL,
    direction touch_direction NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'WON', 'LOST', 'CANCELLED')),

    stake_wei NUMERIC(78, 0) NOT NULL,
    multiplier_bps INTEGER NOT NULL CHECK (multiplier_bps > 0),
    potential_payout_wei NUMERIC(78, 0) NOT NULL,
    house_edge_wei NUMERIC(78, 0) NOT NULL,

    entry_price_q8 NUMERIC(78, 0) NOT NULL,
    target_row_min_q8 NUMERIC(78, 0) NOT NULL,
    target_row_max_q8 NUMERIC(78, 0) NOT NULL,
    window_start_ms BIGINT NOT NULL,
    window_end_ms BIGINT NOT NULL,

    distance_bps INTEGER NOT NULL,
    implied_p_touch_bps INTEGER NOT NULL,
    from_empirical BOOLEAN NOT NULL DEFAULT false,

    touched_at_ms BIGINT,
    realized_pnl_wei NUMERIC(78, 0),
    path_points_hash TEXT,
    disabled_reason TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tap_shadow_bets_active_due
    ON tap_shadow_bets(window_end_ms ASC)
    WHERE status = 'ACTIVE';

CREATE INDEX idx_tap_shadow_bets_symbol_time
    ON tap_shadow_bets(symbol, created_at DESC);

CREATE INDEX idx_tap_shadow_bets_status_time
    ON tap_shadow_bets(status, created_at DESC);
