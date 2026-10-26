-- ============================================================
-- 003 — Phone pattern fixes (found by the eval benchmark)
-- Idempotent: safe to run on every start
-- ============================================================

-- US Phone: a leading \b can never match before "(", so "(415) 555-0198" was
-- missed. Only rewrite the rule if it still has the original pattern.
UPDATE scan_patterns
SET pattern    = '(?:\+1[\s\-]?)?(?:\([0-9]{3}\)|\b[0-9]{3})[\s\-]?[0-9]{3}[\s\-]?[0-9]{4}\b',
    updated_at = NOW()
WHERE name = 'US Phone Number'
  AND is_builtin
  AND pattern = '\b(?:\+1[\s\-]?)?(?:\([0-9]{3}\)|[0-9]{3})[\s\-]?[0-9]{3}[\s\-]?[0-9]{4}\b';

-- Indian mobile numbers written without +91 ("98765 43210")
INSERT INTO scan_patterns (name, description, pattern, category, severity, is_active, is_builtin)
SELECT 'Indian Mobile Number',
       'Indian 10-digit mobile number without country code (starts with 6–9)',
       '\b[6-9][0-9]{4}[\s\-]?[0-9]{5}\b',
       'PHONE', 'MEDIUM', TRUE, TRUE
WHERE NOT EXISTS (SELECT 1 FROM scan_patterns WHERE name = 'Indian Mobile Number');
