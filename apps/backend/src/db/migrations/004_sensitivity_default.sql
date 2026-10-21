-- ============================================================
-- 004 — sensitivity_level now takes effect
-- Idempotent: safe to run on every start
-- ============================================================

-- The setting used to be stored but never read, with a default of HIGH. Now that Scan
-- honours it, HIGH would hide names, places and emails, so the default becomes LOW
-- (show everything). Rewriting the description marks the row as migrated, so a HIGH that
-- someone chooses later is not reset on the next run.
UPDATE settings
SET value = 'LOW',
    description = 'Lowest severity shown in Scan results: LOW | MEDIUM | HIGH | CRITICAL'
WHERE key = 'sensitivity_level'
  AND description = 'Detection sensitivity: LOW | MEDIUM | HIGH';
