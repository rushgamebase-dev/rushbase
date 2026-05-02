-- Migration: Create audit log table
-- Description: Comprehensive audit trail for all system actions

CREATE TYPE audit_action AS ENUM (
    'USER_REGISTER',
    'USER_LOGIN',
    'USER_LOGOUT',
    'POSITION_OPEN',
    'POSITION_CLOSE',
    'POSITION_LIQUIDATE',
    'BALANCE_CREDIT',
    'BALANCE_DEBIT',
    'RISK_LIMIT_UPDATE',
    'ADMIN_ACTION'
);

CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Actor
    user_id UUID REFERENCES users(id),
    admin_id UUID,

    -- Action details
    action audit_action NOT NULL,
    entity_type VARCHAR(50),
    entity_id UUID,

    -- Context
    ip_address INET,
    user_agent TEXT,

    -- Before/After state (JSON)
    old_values JSONB,
    new_values JSONB,

    -- Additional metadata
    metadata JSONB,

    -- Immutable timestamp
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_audit_user_id ON audit_log(user_id);
CREATE INDEX idx_audit_action ON audit_log(action);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_created_at ON audit_log(created_at DESC);
