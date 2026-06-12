const express = require('express');
const { query }          = require('../config/db');
const { validate }       = require('../middleware/validate');
const { reloadPatterns } = require('../services/scanner');

const router = express.Router();

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_CATEGORIES = [
  'CREDIT_CARD', 'PHONE', 'SSN', 'BANK_ACCOUNT',
  'EMAIL', 'PASSPORT', 'API_KEY', 'CUSTOM',
];

const VALID_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const MAX_NAME_LEN        = 100;
const MAX_DESCRIPTION_LEN = 500;
const MAX_PATTERN_LEN     = 2000;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Validates that a regex string compiles without errors.
 * Returns null if valid, or an error message string if invalid.
 *
 * @param {string} pattern - Raw regex string (no surrounding slashes)
 * @returns {string|null}
 */
function validateRegex(pattern) {
  try {
    new RegExp(pattern, 'gi');
    return null;
  } catch (err) {
    return `Invalid regex: ${err.message}`;
  }
}

/**
 * Maps a DB row to the clean API response shape.
 */
function formatRule(row) {
  return {
    id          : row.id,
    name        : row.name,
    description : row.description,
    pattern     : row.pattern,
    category    : row.category,
    severity    : row.severity,
    isActive    : row.is_active,
    isBuiltin   : row.is_builtin,
    createdAt   : row.created_at,
    updatedAt   : row.updated_at,
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(id) {
  return UUID_RE.test(id);
}

// ── GET /api/rules ────────────────────────────────────────────────────────────
//
// Query params (all optional):
//   category   string  — filter by category
//   isActive   bool    — 'true' | 'false'
//   isBuiltin  bool    — 'true' | 'false'
//   severity   string  — filter by severity

router.get('/', async (req, res, next) => {
  try {
    const conditions = [];
    const values     = [];
    let   idx        = 1;

    const { category, isActive, isBuiltin, severity } = req.query;

    if (category) {
      const cat = category.toUpperCase().trim();
      if (!VALID_CATEGORIES.includes(cat)) {
        return res.status(400).json({
          success : false,
          error   : `"category" must be one of: ${VALID_CATEGORIES.join(', ')}`,
        });
      }
      conditions.push(`category = $${idx++}`);
      values.push(cat);
    }

    if (isActive !== undefined) {
      if (!['true', 'false'].includes(isActive)) {
        return res.status(400).json({
          success : false,
          error   : '"isActive" must be "true" or "false"',
        });
      }
      conditions.push(`is_active = $${idx++}`);
      values.push(isActive === 'true');
    }

    if (isBuiltin !== undefined) {
      if (!['true', 'false'].includes(isBuiltin)) {
        return res.status(400).json({
          success : false,
          error   : '"isBuiltin" must be "true" or "false"',
        });
      }
      conditions.push(`is_builtin = $${idx++}`);
      values.push(isBuiltin === 'true');
    }

    if (severity) {
      const sev = severity.toUpperCase().trim();
      if (!VALID_SEVERITIES.includes(sev)) {
        return res.status(400).json({
          success : false,
          error   : `"severity" must be one of: ${VALID_SEVERITIES.join(', ')}`,
        });
      }
      conditions.push(`severity = $${idx++}`);
      values.push(sev);
    }

    const where = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const result = await query(
      `SELECT
         id, name, description, pattern, category,
         severity, is_active, is_builtin, created_at, updated_at
       FROM scan_patterns
       ${where}
       ORDER BY is_builtin DESC, severity DESC, name ASC`,
      values
    );

    return res.status(200).json({
      success : true,
      data    : {
        rules : result.rows.map(formatRule),
        total : result.rowCount,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/rules/:id ────────────────────────────────────────────────────────

router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!isValidUUID(id)) {
      return res.status(400).json({ success: false, error: 'Invalid rule ID format' });
    }

    const result = await query(
      `SELECT
         id, name, description, pattern, category,
         severity, is_active, is_builtin, created_at, updated_at
       FROM scan_patterns
       WHERE id = $1`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Rule not found' });
    }

    return res.status(200).json({
      success : true,
      data    : formatRule(result.rows[0]),
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/rules ───────────────────────────────────────────────────────────
//
// Body:
// {
//   name:        string  (required)
//   pattern:     string  (required, valid regex)
//   category:    string  (required)
//   severity:    string  (required)
//   description: string  (optional)
//   isActive:    bool    (optional, default true)
// }

router.post(
  '/',
  validate((req) => {
    const { name, pattern, category, severity, description } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return '"name" is required';
    }
    if (name.trim().length > MAX_NAME_LEN) {
      return `"name" must be ${MAX_NAME_LEN} characters or fewer`;
    }
    if (!pattern || typeof pattern !== 'string' || pattern.trim().length === 0) {
      return '"pattern" is required';
    }
    if (pattern.trim().length > MAX_PATTERN_LEN) {
      return `"pattern" must be ${MAX_PATTERN_LEN} characters or fewer`;
    }
    const regexError = validateRegex(pattern.trim());
    if (regexError) return regexError;

    if (!category || typeof category !== 'string') {
      return '"category" is required';
    }
    if (!VALID_CATEGORIES.includes(category.toUpperCase().trim())) {
      return `"category" must be one of: ${VALID_CATEGORIES.join(', ')}`;
    }
    if (!severity || typeof severity !== 'string') {
      return '"severity" is required';
    }
    if (!VALID_SEVERITIES.includes(severity.toUpperCase().trim())) {
      return `"severity" must be one of: ${VALID_SEVERITIES.join(', ')}`;
    }
    if (description && typeof description === 'string' && description.length > MAX_DESCRIPTION_LEN) {
      return `"description" must be ${MAX_DESCRIPTION_LEN} characters or fewer`;
    }
  }),
  async (req, res, next) => {
    try {
      const {
        name,
        pattern,
        category,
        severity,
        description = null,
        isActive    = true,
      } = req.body;

      // Check for duplicate name
      const existing = await query(
        `SELECT id FROM scan_patterns WHERE LOWER(name) = LOWER($1)`,
        [name.trim()]
      );
      if (existing.rowCount > 0) {
        return res.status(409).json({
          success : false,
          error   : `A rule named "${name.trim()}" already exists`,
        });
      }

      const result = await query(
        `INSERT INTO scan_patterns
           (name, description, pattern, category, severity, is_active, is_builtin)
         VALUES ($1, $2, $3, $4, $5, $6, FALSE)
         RETURNING
           id, name, description, pattern, category,
           severity, is_active, is_builtin, created_at, updated_at`,
        [
          name.trim(),
          description?.trim() ?? null,
          pattern.trim(),
          category.toUpperCase().trim(),
          severity.toUpperCase().trim(),
          Boolean(isActive),
        ]
      );

      // Invalidate scanner cache so this rule is picked up immediately
      reloadPatterns();

      return res.status(201).json({
        success : true,
        data    : formatRule(result.rows[0]),
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── PUT /api/rules/:id ────────────────────────────────────────────────────────
//
// Only custom (non-builtin) rules can be fully edited.
// Built-in rules only allow toggling isActive.
//
// Body (all fields optional — only provided fields are updated):
// {
//   name?:        string
//   pattern?:     string
//   category?:    string
//   severity?:    string
//   description?: string
//   isActive?:    bool
// }

router.put(
  '/:id',
  validate((req) => {
    const { name, pattern, category, severity, description } = req.body;

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return '"name" must be a non-empty string';
      }
      if (name.trim().length > MAX_NAME_LEN) {
        return `"name" must be ${MAX_NAME_LEN} characters or fewer`;
      }
    }
    if (pattern !== undefined) {
      if (typeof pattern !== 'string' || pattern.trim().length === 0) {
        return '"pattern" must be a non-empty string';
      }
      if (pattern.trim().length > MAX_PATTERN_LEN) {
        return `"pattern" must be ${MAX_PATTERN_LEN} characters or fewer`;
      }
      const regexError = validateRegex(pattern.trim());
      if (regexError) return regexError;
    }
    if (category !== undefined) {
      if (!VALID_CATEGORIES.includes(category.toUpperCase?.().trim())) {
        return `"category" must be one of: ${VALID_CATEGORIES.join(', ')}`;
      }
    }
    if (severity !== undefined) {
      if (!VALID_SEVERITIES.includes(severity.toUpperCase?.().trim())) {
        return `"severity" must be one of: ${VALID_SEVERITIES.join(', ')}`;
      }
    }
    if (description !== undefined && typeof description === 'string') {
      if (description.length > MAX_DESCRIPTION_LEN) {
        return `"description" must be ${MAX_DESCRIPTION_LEN} characters or fewer`;
      }
    }
  }),
  async (req, res, next) => {
    try {
      const { id } = req.params;

      if (!isValidUUID(id)) {
        return res.status(400).json({ success: false, error: 'Invalid rule ID format' });
      }

      // Fetch existing rule
      const existing = await query(
        `SELECT id, is_builtin FROM scan_patterns WHERE id = $1`,
        [id]
      );

      if (existing.rowCount === 0) {
        return res.status(404).json({ success: false, error: 'Rule not found' });
      }

      const rule = existing.rows[0];

      const {
        name,
        pattern,
        category,
        severity,
        description,
        isActive,
      } = req.body;

      // Built-in rules: only isActive can be toggled
      if (rule.is_builtin) {
        if (
          name !== undefined ||
          pattern !== undefined ||
          category !== undefined ||
          severity !== undefined ||
          description !== undefined
        ) {
          return res.status(403).json({
            success : false,
            error   : 'Built-in rules cannot be edited. Only "isActive" can be changed.',
          });
        }

        if (isActive === undefined) {
          return res.status(400).json({
            success : false,
            error   : 'No valid fields provided for update',
          });
        }

        const updated = await query(
          `UPDATE scan_patterns
           SET is_active = $1
           WHERE id = $2
           RETURNING
             id, name, description, pattern, category,
             severity, is_active, is_builtin, created_at, updated_at`,
          [Boolean(isActive), id]
        );

        reloadPatterns();

        return res.status(200).json({
          success : true,
          data    : formatRule(updated.rows[0]),
        });
      }

      // Custom rules: build dynamic SET clause for only provided fields
      const setClauses = [];
      const values     = [];
      let   idx        = 1;

      if (name !== undefined) {
        // Check for duplicate name (excluding current rule)
        const dupe = await query(
          `SELECT id FROM scan_patterns WHERE LOWER(name) = LOWER($1) AND id <> $2`,
          [name.trim(), id]
        );
        if (dupe.rowCount > 0) {
          return res.status(409).json({
            success : false,
            error   : `A rule named "${name.trim()}" already exists`,
          });
        }
        setClauses.push(`name = $${idx++}`);
        values.push(name.trim());
      }

      if (pattern !== undefined) {
        setClauses.push(`pattern = $${idx++}`);
        values.push(pattern.trim());
      }

      if (category !== undefined) {
        setClauses.push(`category = $${idx++}`);
        values.push(category.toUpperCase().trim());
      }

      if (severity !== undefined) {
        setClauses.push(`severity = $${idx++}`);
        values.push(severity.toUpperCase().trim());
      }

      if (description !== undefined) {
        setClauses.push(`description = $${idx++}`);
        values.push(description?.trim() ?? null);
      }

      if (isActive !== undefined) {
        setClauses.push(`is_active = $${idx++}`);
        values.push(Boolean(isActive));
      }

      if (setClauses.length === 0) {
        return res.status(400).json({
          success : false,
          error   : 'No valid fields provided for update',
        });
      }

      values.push(id);

      const updated = await query(
        `UPDATE scan_patterns
         SET ${setClauses.join(', ')}
         WHERE id = $${idx}
         RETURNING
           id, name, description, pattern, category,
           severity, is_active, is_builtin, created_at, updated_at`,
        values
      );

      reloadPatterns();

      return res.status(200).json({
        success : true,
        data    : formatRule(updated.rows[0]),
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── DELETE /api/rules/:id ─────────────────────────────────────────────────────
//
// Built-in rules cannot be deleted — only deactivated via PUT.

router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!isValidUUID(id)) {
      return res.status(400).json({ success: false, error: 'Invalid rule ID format' });
    }

    const existing = await query(
      `SELECT id, name, is_builtin FROM scan_patterns WHERE id = $1`,
      [id]
    );

    if (existing.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Rule not found' });
    }

    const rule = existing.rows[0];

    if (rule.is_builtin) {
      return res.status(403).json({
        success : false,
        error   : 'Built-in rules cannot be deleted. Use PUT to disable them instead.',
      });
    }

    await query(`DELETE FROM scan_patterns WHERE id = $1`, [id]);

    reloadPatterns();

    return res.status(200).json({
      success : true,
      data    : { id, name: rule.name, deleted: true },
    });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/rules/:id/toggle ───────────────────────────────────────────────
//
// Convenience endpoint — flips isActive on any rule (builtin or custom).

router.patch('/:id/toggle', async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!isValidUUID(id)) {
      return res.status(400).json({ success: false, error: 'Invalid rule ID format' });
    }

    const existing = await query(
      `SELECT id, is_active FROM scan_patterns WHERE id = $1`,
      [id]
    );

    if (existing.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Rule not found' });
    }

    const currentActive = existing.rows[0].is_active;

    const updated = await query(
      `UPDATE scan_patterns
       SET is_active = $1
       WHERE id = $2
       RETURNING
         id, name, description, pattern, category,
         severity, is_active, is_builtin, created_at, updated_at`,
      [!currentActive, id]
    );

    reloadPatterns();

    return res.status(200).json({
      success : true,
      data    : formatRule(updated.rows[0]),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;