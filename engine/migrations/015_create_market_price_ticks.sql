-- Migration: Persist real-market price ticks used by Tap Trading.
--
-- The in-process feed remains the hot path for quotes/WS, but every
-- accepted market tick is also written here so resolution can survive
-- process restarts and auditors can replay the exact price window.

CREATE TABLE market_price_ticks (
    symbol VARCHAR(20) NOT NULL,
    timestamp_ms BIGINT NOT NULL,
    price_q8 NUMERIC(78, 0) NOT NULL,
    source VARCHAR(32) NOT NULL DEFAULT 'binance',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (symbol, timestamp_ms),
    CONSTRAINT market_price_ticks_positive_price CHECK (price_q8 > 0)
);

CREATE INDEX idx_market_price_ticks_symbol_time_desc
    ON market_price_ticks(symbol, timestamp_ms DESC);

