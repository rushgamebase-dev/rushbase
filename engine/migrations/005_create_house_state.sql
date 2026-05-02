-- Migration: Create house state table
-- House solvency tracking. All amounts in wei; all limits configurable
-- via app config (`risk.*`) and synced into this row at startup.

CREATE TABLE house_state (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Funded house buffer mirrored from on-chain `houseBalance` (TradingVault).
    -- Engine refuses new positions when buffer falls below `min_buffer_wei`.
    house_buffer_wei NUMERIC(78, 0) NOT NULL DEFAULT 0,

    -- Cumulative house P&L (signed, in wei).
    realized_pnl_wei NUMERIC(78, 0) NOT NULL DEFAULT 0,

    -- Statistics
    total_volume_wei NUMERIC(78, 0) NOT NULL DEFAULT 0,
    total_trades INTEGER NOT NULL DEFAULT 0,

    -- Circuit breaker (auto-triggered by ExposureTracker, manually clearable).
    circuit_breaker_triggered BOOLEAN NOT NULL DEFAULT false,
    circuit_breaker_reason TEXT,
    circuit_breaker_triggered_at TIMESTAMPTZ,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_house_state_singleton ON house_state((id IS NOT NULL));

-- Audit log of every change to the house buffer.
CREATE TABLE house_ledger (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    tx_type VARCHAR(32) NOT NULL,
    amount_wei NUMERIC(78, 0) NOT NULL,
    buffer_before_wei NUMERIC(78, 0) NOT NULL,
    buffer_after_wei NUMERIC(78, 0) NOT NULL,

    -- Touch bet that caused this entry. Field name kept as `position_id`
    -- to match the Rust model field; the FK target was originally
    -- `positions` (leverage trading) but is now `touch_bets`.
    position_id UUID REFERENCES touch_bets(id),
    user_id UUID REFERENCES users(id),

    chain_tx_hash VARCHAR(66),
    chain_log_index INTEGER,

    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_house_ledger_created ON house_ledger(created_at DESC);
CREATE INDEX idx_house_ledger_position ON house_ledger(position_id);
CREATE UNIQUE INDEX idx_house_ledger_chain_log
    ON house_ledger(chain_tx_hash, chain_log_index)
    WHERE chain_tx_hash IS NOT NULL;

CREATE TRIGGER update_house_state_updated_at
    BEFORE UPDATE ON house_state
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Singleton row. Buffer starts at zero; the team funds the vault on-chain
-- and the listener mirrors it here.
INSERT INTO house_state DEFAULT VALUES ON CONFLICT DO NOTHING;

-- Leaderboard view ranks users by realized PnL across all closed trades.
CREATE OR REPLACE VIEW leaderboard AS
SELECT
    u.id,
    u.wallet_address,
    u.username,
    u.realized_pnl_wei,
    u.total_trades,
    u.total_wins,
    u.total_losses,
    CASE
        WHEN u.total_trades > 0
        THEN ROUND((u.total_wins::DECIMAL / u.total_trades) * 100, 2)
        ELSE 0
    END as win_rate,
    u.best_win_streak,
    u.created_at
FROM users u
WHERE u.is_active = true AND u.total_trades > 0
ORDER BY u.realized_pnl_wei DESC;
