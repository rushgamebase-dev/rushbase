-- Migration: touch-in-window bets table.
--
-- Each bet picks a target *price band* (a "row" of the visual grid) and a
-- *time window* (a "column"). The bet wins if the symbol's traded price
-- crosses the band at any point inside the window. Multiplier is fixed at
-- placement time and computed by the engine from distance + window
-- duration + house edge. No leverage, no liquidation.
--
-- Resolution states:
--   ACTIVE → WON | LOST | CANCELLED
--
-- Audit columns: touched_at is set the first time the band was crossed
-- inside the window; resolved_at is set when the engine settled the bet
-- (either after window_end_ms elapsed or because a touch was confirmed).

CREATE TYPE touch_direction AS ENUM ('UP', 'DOWN');
CREATE TYPE touch_status AS ENUM ('ACTIVE', 'WON', 'LOST', 'CANCELLED');

CREATE TABLE touch_bets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    symbol VARCHAR(20) NOT NULL,
    direction touch_direction NOT NULL,
    status touch_status NOT NULL DEFAULT 'ACTIVE',

    -- Stake locked from the user. Returns to free balance on resolution.
    stake_wei NUMERIC(78, 0) NOT NULL,
    -- Multiplier applied to stake on win. 10000 bps = 1.0x; min allowed 10000.
    multiplier_bps INTEGER NOT NULL,
    -- Pre-computed payout = stake_wei * multiplier_bps / 10000.
    potential_payout_wei NUMERIC(78, 0) NOT NULL,
    -- House-edge component baked into multiplier. Surfaced for transparency.
    house_edge_wei NUMERIC(78, 0) NOT NULL DEFAULT 0,

    -- Snapshot of the symbol price when the bet was placed (1e8 q8).
    entry_price_q8 NUMERIC(78, 0) NOT NULL,
    -- Inclusive bounds of the target band (1e8 q8).
    target_row_min_q8 NUMERIC(78, 0) NOT NULL,
    target_row_max_q8 NUMERIC(78, 0) NOT NULL,

    -- Window the price must touch the band in (epoch milliseconds).
    window_start_ms BIGINT NOT NULL,
    window_end_ms BIGINT NOT NULL,

    placed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    touched_at TIMESTAMPTZ,
    -- Signed wei. Positive on WON; negative on LOST (= -stake).
    realized_pnl_wei NUMERIC(78, 0),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT positive_stake CHECK (stake_wei > 0),
    CONSTRAINT positive_payout CHECK (potential_payout_wei >= stake_wei),
    CONSTRAINT min_multiplier CHECK (multiplier_bps >= 10000),
    CONSTRAINT valid_window CHECK (window_end_ms > window_start_ms),
    CONSTRAINT valid_band CHECK (target_row_max_q8 > target_row_min_q8),
    CONSTRAINT positive_entry_price CHECK (entry_price_q8 > 0)
);

CREATE INDEX idx_touch_bets_user_id ON touch_bets(user_id);
CREATE INDEX idx_touch_bets_status ON touch_bets(status);
CREATE INDEX idx_touch_bets_user_status ON touch_bets(user_id, status);
CREATE INDEX idx_touch_bets_symbol ON touch_bets(symbol);
-- Hot index used by the resolution loop: scan ACTIVE bets whose window has
-- elapsed.
CREATE INDEX idx_touch_bets_active_window_end
    ON touch_bets(window_end_ms) WHERE status = 'ACTIVE';
CREATE INDEX idx_touch_bets_user_placed
    ON touch_bets(user_id, placed_at DESC);

CREATE TRIGGER update_touch_bets_updated_at
    BEFORE UPDATE ON touch_bets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
