const express = require('express');
const { query } = require('../config/db');

const router = express.Router();

const DEFAULT_PAGE      = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE     = 100;

const VALID_SORT_FIELDS = ['created_at', 'risk_score', 'detection_count'];
const VALID_SORT_DIRS   = ['ASC', 'DESC'];
const VALID_STYLES      = ['REDACT', 'PARTIAL', 'TOKENIZE'];

/**
 * Parses and validates all query params for GET /api/audit.
 * Returns { params, error } — if error is set, params is null.
 *
 * Supported query params:
 *   page        number   default 1
 *   pageSize    number   default 20, max 100
 *   sortBy      string   created_at | risk_score | detection_count
 *   sortDir     string   ASC | DESC
 *   minRisk     number   0–100
 *   maxRisk     number   0–100
 *   style       string   REDACT | PARTIAL | TOKENIZE
 *   category    string   e.g. CREDIT_CARD, SSN, PHONE
 *   dateFrom    ISO8601  e.g. 2026-01-01T00:00:00Z
 *   dateTo      ISO8601
 *   hasDetections  bool  true = only rows with detections > 0
 */
function parseQueryParams(q) {
  const errors = [];

  // ── Pagination ────────────────────────────────────────────────────────
  let page = parseInt(q.page, 10);
  if (isNaN(page) || page < 1) page = DEFAULT_PAGE;

  let pageSize = parseInt(q.pageSize, 10);
  if (isNaN(pageSize) || pageSize < 1) pageSize = DEFAULT_PAGE_SIZE;
  if (pageSize > MAX_PAGE_SIZE) pageSize = MAX_PAGE_SIZE;

  // ── Sorting ───────────────────────────────────────────────────────────
  const sortBy  = VALID_SORT_FIELDS.includes(q.sortBy)  ? q.sortBy  : 'created_at';
  const sortDir = VALID_SORT_DIRS.includes(q.sortDir?.toUpperCase())
    ? q.sortDir.toUpperCase()
    : 'DESC';

  // ── Risk score filter ─────────────────────────────────────────────────
  let minRisk = q.minRisk !== undefined ? parseInt(q.minRisk, 10) : null;
  let maxRisk = q.maxRisk !== undefined ? parseInt(q.maxRisk, 10) : null;

  if (minRisk !== null && (isNaN(minRisk) || minRisk < 0 || minRisk > 100)) {
    errors.push('"minRisk" must be an integer between 0 and 100');
  }
  if (maxRisk !== null && (isNaN(maxRisk) || maxRisk < 0 || maxRisk > 100)) {
    errors.push('"maxRisk" must be an integer between 0 and 100');
  }
  if (minRisk !== null && maxRisk !== null && minRisk > maxRisk) {
    errors.push('"minRisk" must be less than or equal to "maxRisk"');
  }

  // ── Style filter ──────────────────────────────────────────────────────
  let style = null;
  if (q.style !== undefined) {
    if (!VALID_STYLES.includes(q.style.toUpperCase())) {
      errors.push(`"style" must be one of: ${VALID_STYLES.join(', ')}`);
    } else {
      style = q.style.toUpperCase();
    }
  }

  // ── Category filter ───────────────────────────────────────────────────
  const category = q.category ? q.category.toUpperCase().trim() : null;

  // ── Date range filter ─────────────────────────────────────────────────
  let dateFrom = null;
  let dateTo   = null;

  if (q.dateFrom) {
    const d = new Date(q.dateFrom);
    if (isNaN(d.getTime())) {
      errors.push('"dateFrom" must be a valid ISO 8601 date');
    } else {
      dateFrom = d.toISOString();
    }
  }

  if (q.dateTo) {
    const d = new Date(q.dateTo);
    if (isNaN(d.getTime())) {
      errors.push('"dateTo" must be a valid ISO 8601 date');
    } else {
      dateTo = d.toISOString();
    }
  }

  if (dateFrom && dateTo && new Date(dateFrom) > new Date(dateTo)) {
    errors.push('"dateFrom" must be before "dateTo"');
  }

  // ── hasDetections filter ──────────────────────────────────────────────
  let hasDetections = null;
  if (q.hasDetections !== undefined) {
    if (q.hasDetections === 'true')       hasDetections = true;
    else if (q.hasDetections === 'false') hasDetections = false;
    else errors.push('"hasDetections" must be "true" or "false"');
  }

  if (errors.length > 0) {
    return { params: null, error: errors.join('; ') };
  }

  return {
    params: {
      page, pageSize, sortBy, sortDir,
      minRisk, maxRisk, style, category,
      dateFrom, dateTo, hasDetections,
    },
    error: null,
  };
}

/**
 * Builds the WHERE clause and $N parameter list dynamically.
 *
 * @param {object} params - Parsed query params
 * @returns {{ whereClause: string, values: any[] }}
 */
function buildWhereClause(params) {
  const conditions = [];
  const values     = [];
  let   idx        = 1;

  if (params.minRisk !== null) {
    conditions.push(`risk_score >= $${idx++}`);
    values.push(params.minRisk);
  }
  if (params.maxRisk !== null) {
    conditions.push(`risk_score <= $${idx++}`);
    values.push(params.maxRisk);
  }
  if (params.style) {
    conditions.push(`mask_style = $${idx++}`);
    values.push(params.style);
  }
  if (params.dateFrom) {
    conditions.push(`created_at >= $${idx++}`);
    values.push(params.dateFrom);
  }
  if (params.dateTo) {
    conditions.push(`created_at <= $${idx++}`);
    values.push(params.dateTo);
  }
  if (params.hasDetections === true) {
    conditions.push(`detection_count > 0`);
  }
  if (params.hasDetections === false) {
    conditions.push(`detection_count = 0`);
  }
  if (params.category) {
    // Filter rows where detections JSONB array contains an object
    // with a matching category field
    conditions.push(
      `EXISTS (
        SELECT 1 FROM jsonb_array_elements(detections) AS d
        WHERE d->>'category' = $${idx++}
      )`
    );
    values.push(params.category);
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  return { whereClause, values };
}

/**
 * GET /api/audit
 *
 * Query params (all optional):
 *   page, pageSize, sortBy, sortDir,
 *   minRisk, maxRisk, style, category,
 *   dateFrom, dateTo, hasDetections
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     records: AuditRecord[],
 *     pagination: {
 *       page:       number,
 *       pageSize:   number,
 *       totalCount: number,
 *       totalPages: number,
 *       hasNext:    boolean,
 *       hasPrev:    boolean,
 *     }
 *   }
 * }
 */
router.get('/', async (req, res, next) => {
  try {
    const { params, error } = parseQueryParams(req.query);

    if (error) {
      return res.status(400).json({ success: false, error });
    }

    const { whereClause, values } = buildWhereClause(params);

    // ── Count query (for pagination metadata) ─────────────────────────
    const countResult = await query(
      `SELECT COUNT(*) AS total FROM audit_logs ${whereClause}`,
      values
    );
    const totalCount = parseInt(countResult.rows[0].total, 10);
    const totalPages = Math.ceil(totalCount / params.pageSize);

    // ── Data query ────────────────────────────────────────────────────
    const offset = (params.page - 1) * params.pageSize;

    // Append LIMIT/OFFSET params after WHERE params
    const dataValues  = [...values, params.pageSize, offset];
    const limitIdx    = values.length + 1;
    const offsetIdx   = values.length + 2;

    const dataResult = await query(
      `SELECT
          id,
          input_text        AS "inputText",
          masked_text       AS "maskedText",
          detection_count   AS "detectionCount",
          detections,
          mask_style        AS "maskStyle",
          risk_score        AS "riskScore",
          source_ip         AS "sourceIp",
          user_agent        AS "userAgent",
          created_at        AS "createdAt"
       FROM audit_logs
       ${whereClause}
       ORDER BY ${params.sortBy} ${params.sortDir}
       LIMIT  $${limitIdx}
       OFFSET $${offsetIdx}`,
      dataValues
    );

    return res.status(200).json({
      success: true,
      data: {
        records: dataResult.rows,
        pagination: {
          page:       params.page,
          pageSize:   params.pageSize,
          totalCount,
          totalPages,
          hasNext:    params.page < totalPages,
          hasPrev:    params.page > 1,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/audit/:id
 * Returns a single audit log record by UUID.
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Basic UUID format guard
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(id)) {
      return res.status(400).json({ success: false, error: 'Invalid audit log ID format' });
    }

    const result = await query(
      `SELECT
          id,
          input_text        AS "inputText",
          masked_text       AS "maskedText",
          detection_count   AS "detectionCount",
          detections,
          mask_style        AS "maskStyle",
          risk_score        AS "riskScore",
          source_ip         AS "sourceIp",
          user_agent        AS "userAgent",
          created_at        AS "createdAt"
       FROM audit_logs
       WHERE id = $1`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Audit log not found' });
    }

    return res.status(200).json({
      success: true,
      data: result.rows[0],
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;