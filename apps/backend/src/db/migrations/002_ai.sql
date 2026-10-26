-- ============================================================
-- 002 — AI detection
-- Idempotent: safe to run on every start
-- ============================================================

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS detection_mode     VARCHAR(10),          -- REGEX, AI, HYBRID
  ADD COLUMN IF NOT EXISTS injection_score    REAL,                 -- 0–1, NULL when not checked
  ADD COLUMN IF NOT EXISTS ai_detection_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE scan_patterns
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'MANUAL'; -- MANUAL, AI_GENERATED

INSERT INTO settings (key, value, description) VALUES
  ('detection_mode',          'HYBRID', 'Detection engine: REGEX | AI | HYBRID'),
  ('ai_confidence_threshold', '0.6',    'Minimum confidence (0–1) for a detection to be reported'),
  ('injection_check',         'true',   'Whether prompts are checked for prompt injection')
ON CONFLICT (key) DO NOTHING;
