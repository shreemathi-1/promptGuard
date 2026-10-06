-- ============================================================
-- DLP System — Full Schema
-- Run once against dlp_db
-- ============================================================

-- Extension for UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- SCAN PATTERNS
-- Built-in + custom regex rules used by the detection engine
-- ============================================================
CREATE TABLE IF NOT EXISTS scan_patterns (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL,
  description TEXT,
  pattern     TEXT        NOT NULL,
  category    VARCHAR(50) NOT NULL,   -- e.g. CREDIT_CARD, PHONE, SSN, BANK_ACCOUNT, CUSTOM
  severity    VARCHAR(20) NOT NULL DEFAULT 'HIGH', -- LOW, MEDIUM, HIGH, CRITICAL
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  is_builtin  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- AUDIT LOGS
-- Every scan request is recorded here
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  input_text      TEXT        NOT NULL,
  masked_text     TEXT,
  detection_count INTEGER     NOT NULL DEFAULT 0,
  detections      JSONB       NOT NULL DEFAULT '[]',
  mask_style      VARCHAR(20),         -- REDACT, PARTIAL, TOKENIZE
  risk_score      INTEGER     NOT NULL DEFAULT 0, -- 0–100
  source_ip       VARCHAR(45),
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- SETTINGS
-- Key/value store for system-wide configuration
-- ============================================================
CREATE TABLE IF NOT EXISTS settings (
  key         VARCHAR(100) PRIMARY KEY,
  value       TEXT         NOT NULL,
  description TEXT,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
  ON audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_risk_score
  ON audit_logs (risk_score DESC);

CREATE INDEX IF NOT EXISTS idx_scan_patterns_category
  ON scan_patterns (category);

CREATE INDEX IF NOT EXISTS idx_scan_patterns_is_active
  ON scan_patterns (is_active);

-- ============================================================
-- DEFAULT SETTINGS
-- ============================================================
INSERT INTO settings (key, value, description) VALUES
  ('mask_style',        'REDACT',  'Default masking style: REDACT | PARTIAL | TOKENIZE'),
  ('sensitivity_level', 'HIGH',    'Detection sensitivity: LOW | MEDIUM | HIGH'),
  ('log_input_text',    'true',    'Whether to store raw input text in audit logs')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- UPDATED_AT AUTO-UPDATE TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_scan_patterns_updated_at
  BEFORE UPDATE ON scan_patterns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER trg_settings_updated_at
  BEFORE UPDATE ON settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();