const express = require('express');
const { query } = require('../config/db');

const router = express.Router();

// ── Allowed settings registry ─────────────────────────────────────────────────
//
// Defines every setting the API will expose.
// Unknown keys are rejected — this prevents arbitrary key/value injection.

const SETTINGS_REGISTRY = {
  mask_style: {
    description  : 'Default masking style applied when no style is specified in the request',
    allowedValues: ['REDACT', 'PARTIAL', 'TOKENIZE'],
    type         : 'enum',
  },
  sensitivity_level: {
    description  : 'Controls which severity levels are included in scan results',
    allowedValues: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    type         : 'enum',
  },
  log_input_text: {
    description  : 'When false, raw input text is not stored in audit logs (stores placeholder instead)',
    allowedValues: ['true', 'false'],
    type         : 'boolean',
  },
};

const ALLOWED_KEYS = Object.keys(SETTINGS_REGISTRY);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Formats a raw DB settings row into the API response shape.
 *
 * @param {object} row  — raw DB row { key, value, description, updated_at }
 * @returns {object}
 */
function formatSetting(row) {
  const meta = SETTINGS_REGISTRY[row.key] ?? {};

  return {
    key          : row.key,
    value        : row.value,
    description  : row.description ?? meta.description ?? null,
    type         : meta.type ?? 'string',
    allowedValues: meta.allowedValues ?? null,
    updatedAt    : row.updated_at,
  };
}

// ── GET /api/settings ─────────────────────────────────────────────────────────
//
// Returns all settings as an array.
//
// Response:
// {
//   success: true,
//   data: {
//     settings: Setting[]
//   }
// }

router.get('/', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT key, value, description, updated_at
       FROM settings
       WHERE key = ANY($1)
       ORDER BY key ASC`,
      [ALLOWED_KEYS]
    );

    return res.status(200).json({
      success : true,
      data    : {
        settings: result.rows.map(formatSetting),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/settings/:key ────────────────────────────────────────────────────
//
// Returns a single setting by key.

router.get('/:key', async (req, res, next) => {
  try {
    const { key } = req.params;

    if (!ALLOWED_KEYS.includes(key)) {
      return res.status(404).json({
        success : false,
        error   : `Unknown setting key "${key}". Allowed keys: ${ALLOWED_KEYS.join(', ')}`,
      });
    }

    const result = await query(
      `SELECT key, value, description, updated_at
       FROM settings
       WHERE key = $1`,
      [key]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success : false,
        error   : `Setting "${key}" not found`,
      });
    }

    return res.status(200).json({
      success : true,
      data    : formatSetting(result.rows[0]),
    });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/settings/:key ────────────────────────────────────────────────────
//
// Updates the value of a single setting.
//
// Body:
// {
//   value: string   ← required
// }
//
// Response:
// {
//   success: true,
//   data: Setting
// }

router.put('/:key', async (req, res, next) => {
  try {
    const { key } = req.params;

    // ── Validate key ────────────────────────────────────────────────────────
    if (!ALLOWED_KEYS.includes(key)) {
      return res.status(404).json({
        success : false,
        error   : `Unknown setting key "${key}". Allowed keys: ${ALLOWED_KEYS.join(', ')}`,
      });
    }

    // ── Validate value presence ─────────────────────────────────────────────
    const { value } = req.body;

    if (value === undefined || value === null) {
      return res.status(400).json({
        success : false,
        error   : '"value" is required',
      });
    }

    if (typeof value !== 'string') {
      return res.status(400).json({
        success : false,
        error   : '"value" must be a string',
      });
    }

    const trimmed = value.trim();

    if (trimmed.length === 0) {
      return res.status(400).json({
        success : false,
        error   : '"value" must not be empty',
      });
    }

    // ── Validate against allowed values ─────────────────────────────────────
    const meta = SETTINGS_REGISTRY[key];

    if (meta.allowedValues && !meta.allowedValues.includes(trimmed)) {
      return res.status(400).json({
        success : false,
        error   : `Invalid value "${trimmed}" for setting "${key}". Allowed values: ${meta.allowedValues.join(', ')}`,
      });
    }

    // ── Upsert ──────────────────────────────────────────────────────────────
    const result = await query(
      `INSERT INTO settings (key, value, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (key)
       DO UPDATE SET
         value      = EXCLUDED.value,
         updated_at = NOW()
       RETURNING key, value, description, updated_at`,
      [key, trimmed, meta.description ?? null]
    );

    return res.status(200).json({
      success : true,
      data    : formatSetting(result.rows[0]),
    });
  } catch (err) {
    next(err);
  }
});

// ── PUT /api/settings (bulk update) ──────────────────────────────────────────
//
// Updates multiple settings in a single request.
//
// Body:
// {
//   settings: { [key]: value }
// }
//
// Response:
// {
//   success: true,
//   data: {
//     updated: Setting[],
//     errors:  { key, error }[]
//   }
// }

router.put('/', async (req, res, next) => {
  try {
    const { settings } = req.body;

    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return res.status(400).json({
        success : false,
        error   : '"settings" must be a key/value object',
      });
    }

    const entries = Object.entries(settings);

    if (entries.length === 0) {
      return res.status(400).json({
        success : false,
        error   : '"settings" must contain at least one key/value pair',
      });
    }

    const updated = [];
    const errors  = [];

    for (const [key, value] of entries) {
      // Validate key
      if (!ALLOWED_KEYS.includes(key)) {
        errors.push({ key, error: `Unknown setting key "${key}"` });
        continue;
      }

      // Validate value
      if (value === undefined || value === null || typeof value !== 'string') {
        errors.push({ key, error: 'Value must be a non-null string' });
        continue;
      }

      const trimmed = value.trim();

      if (trimmed.length === 0) {
        errors.push({ key, error: 'Value must not be empty' });
        continue;
      }

      const meta = SETTINGS_REGISTRY[key];

      if (meta.allowedValues && !meta.allowedValues.includes(trimmed)) {
        errors.push({
          key,
          error: `Invalid value "${trimmed}". Allowed: ${meta.allowedValues.join(', ')}`,
        });
        continue;
      }

      // Upsert valid setting
      try {
        const result = await query(
          `INSERT INTO settings (key, value, description)
           VALUES ($1, $2, $3)
           ON CONFLICT (key)
           DO UPDATE SET
             value      = EXCLUDED.value,
             updated_at = NOW()
           RETURNING key, value, description, updated_at`,
          [key, trimmed, meta.description ?? null]
        );
        updated.push(formatSetting(result.rows[0]));
      } catch (dbErr) {
        errors.push({ key, error: dbErr.message });
      }
    }

    return res.status(200).json({
      success : true,
      data    : { updated, errors },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;