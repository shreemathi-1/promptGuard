const express = require('express');
const { query } = require('../config/db');

const router = express.Router();

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_EXPORT_ROWS = 10_000;

const ALL_COLUMNS = [
  { key: 'id',             header: 'ID',               always: true  },
  { key: 'created_at',     header: 'Timestamp',         always: true  },
  { key: 'risk_score',     header: 'Risk Score',        always: false },
  { key: 'detection_count',header: 'Detection Count',   always: false },
  { key: 'mask_style',     header: 'Mask Style',        always: false },
  { key: 'categories',     header: 'Categories',        always: false },
  { key: 'severities',     header: 'Severities',        always: false },
  { key: 'input_preview',  header: 'Input Preview',     always: false },
  { key: 'masked_preview', header: 'Masked Preview',    always: false },
  { key: 'source_ip',      header: 'Source IP',         always: false },
];

const DEFAULT_COLUMNS = [
  'id', 'created_at', 'risk_score',
  'detection_count', 'mask_style', 'categories',
];

const VALID_SORT_FIELDS = ['created_at', 'risk_score', 'detection_count'];
const VALID_SORT_DIRS   = ['ASC', 'DESC'];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Escapes a value for RFC 4180-compliant CSV output.
 * - Wraps in double quotes if the value contains commas, quotes, or newlines.
 * - Doubles any internal double-quote characters.
 * - Converts null/undefined to empty string.
 *
 * @param {*} value
 * @returns {string}
 */
function csvEscape(value) {
  if (value === null || value === undefined) return '';

  const str = String(value);

  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Converts an array of row objects into a CSV string.
 *
 * @param {string[]}  headers  — column header labels
 * @param {string[][]} rows    — 2D array of cell values (already strings)
 * @returns {string}
 */
function buildCSV(headers, rows) {
  const lines = [];

  // Header row
  lines.push(headers.map(csvEscape).join(','));

  // Data rows
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(','));
  }

  return lines.join('\r\n');
}

/**
 * Extracts a sorted, deduplicated list of category names from a JSONB
 * detections array. Returns a pipe-separated string.
 *
 * @param {object[]|null} detections — parsed JSONB from DB
 * @returns {string}
 */
function extractCategories(detections) {
  if (!Array.isArray(detections) || detections.length === 0) return '';
  const cats = [...new Set(detections.map(d => d.category).filter(Boolean))].sort();
  return cats.join(' | ');
}

/**
 * Extracts a severity summary from a detections array.
 * e.g. "CRITICAL×2, HIGH×1"
 *
 * @param {object[]|null} detections
 * @returns {string}
 */
function extractSeverities(detections) {
  if (!Array.isArray(detections) || detections.length === 0) return '';

  const RANK = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
  const counts = {};

  for (const d of detections) {
    if (d.severity) counts[d.severity] = (counts[d.severity] ?? 0) + 1;
  }

  return Object.entries(counts)
    .sort((a, b) => (RANK[b[0]] ?? 0) - (RANK[a[0]] ?? 0))
    .map(([sev, cnt]) => cnt > 1 ? `${sev}×${cnt}` : sev)
    .join(', ');
}

/**
 * Truncates a string to maxLen chars, appending '…' if trimmed.
 */
function truncate(str, maxLen = 120) {
  if (!str) return '';
  const s = str.replace(/[\r\n]+/g, ' ');
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
}

/**
 * Parses and validates query params for the export endpoint.
 */
function parseExportParams(q) {
  const errors = [];

  // ── Columns ───────────────────────────────────────────────────────────────
  let columns = DEFAULT_COLUMNS;
  if (q.columns) {
    const requested = q.columns.split(',').map(c => c.trim().toLowerCase());
    const validKeys = new Set(ALL_COLUMNS.map(c => c.key));
    const invalid   = requested.filter(c => !validKeys.has(c));
    if (invalid.length > 0) {
      errors.push(`Unknown columns: ${invalid.join(', ')}`);
    } else {
      columns = requested;
    }
  }

  // Ensure always-required columns are present
  const alwaysKeys = ALL_COLUMNS.filter(c => c.always).map(c => c.key);
  for (const key of alwaysKeys) {
    if (!columns.includes(key)) columns = [key, ...columns];
  }

  // ── Row limit ─────────────────────────────────────────────────────────────
  let limit = parseInt(q.limit, 10);
  if (isNaN(limit) || limit < 1) limit = 1000;
  if (limit > MAX_EXPORT_ROWS)   limit = MAX_EXPORT_ROWS;

  // ── Filters ───────────────────────────────────────────────────────────────
  let minRisk  = q.minRisk  !== undefined ? parseInt(q.minRisk,  10) : null;
  let maxRisk  = q.maxRisk  !== undefined ? parseInt(q.maxRisk,  10) : null;

  if (minRisk !== null && (isNaN(minRisk) || minRisk < 0 || minRisk > 100)) {
    errors.push('"minRisk" must be 0–100');
    minRisk = null;
  }
  if (maxRisk !== null && (isNaN(maxRisk) || maxRisk < 0 || maxRisk > 100)) {
    errors.push('"maxRisk" must be 0–100');
    maxRisk = null;
  }
  if (minRisk !== null && maxRisk !== null && minRisk > maxRisk) {
    errors.push('"minRisk" must be ≤ "maxRisk"');
  }

  let dateFrom = null;
  let dateTo   = null;
  if (q.dateFrom) {
    const d = new Date(q.dateFrom);
    if (isNaN(d.getTime())) errors.push('"dateFrom" must be a valid ISO 8601 date');
    else dateFrom = d.toISOString();
  }
  if (q.dateTo) {
    const d = new Date(q.dateTo);
    if (isNaN(d.getTime())) errors.push('"dateTo" must be a valid ISO 8601 date');
    else dateTo = d.toISOString();
  }
  if (dateFrom && dateTo && new Date(dateFrom) > new Date(dateTo)) {
    errors.push('"dateFrom" must be before "dateTo"');
  }

  let style = null;
  if (q.style) {
    const s = q.style.toUpperCase().trim();
    if (!['REDACT', 'PARTIAL', 'TOKENIZE'].includes(s)) {
      errors.push('"style" must be REDACT, PARTIAL, or TOKENIZE');
    } else {
      style = s;
    }
  }

  let hasDetections = null;
  if (q.hasDetections !== undefined) {
    if      (q.hasDetections === 'true')  hasDetections = true;
    else if (q.hasDetections === 'false') hasDetections = false;
    else errors.push('"hasDetections" must be "true" or "false"');
  }

  // ── Sort ──────────────────────────────────────────────────────────────────
  const sortBy  = VALID_SORT_FIELDS.includes(q.sortBy)  ? q.sortBy  : 'created_at';
  const sortDir = VALID_SORT_DIRS.includes(q.sortDir?.toUpperCase())
    ? q.sortDir.toUpperCase()
    : 'DESC';

  if (errors.length > 0) {
    return { params: null, error: errors.join('; ') };
  }

  return {
    params : {
      columns, limit,
      minRisk, maxRisk, style,
      dateFrom, dateTo, hasDetections,
      sortBy, sortDir,
    },
    error: null,
  };
}

// ── GET /api/export/audit ─────────────────────────────────────────────────────
//
// Streams a CSV file of audit log records filtered by query params.
//
// Query params:
//   columns       comma-separated list of column keys (default: DEFAULT_COLUMNS)
//   limit         max rows (default 1000, max 10000)
//   minRisk       0–100
//   maxRisk       0–100
//   style         REDACT | PARTIAL | TOKENIZE
//   dateFrom      ISO 8601
//   dateTo        ISO 8601
//   hasDetections true | false
//   sortBy        created_at | risk_score | detection_count
//   sortDir       ASC | DESC
//   format        csv | json  (default: csv)

router.get('/audit', async (req, res, next) => {
  try {
    const { params, error } = parseExportParams(req.query);

    if (error) {
      return res.status(400).json({ success: false, error });
    }

    const format = req.query.format === 'json' ? 'json' : 'csv';

    // ── Build WHERE clause ──────────────────────────────────────────────────
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

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    values.push(params.limit);

    // ── Fetch rows ──────────────────────────────────────────────────────────
    const result = await query(
      `SELECT
         id,
         created_at,
         risk_score,
         detection_count,
         mask_style,
         detections,
         input_text,
         masked_text,
         source_ip
       FROM audit_logs
       ${whereClause}
       ORDER BY ${params.sortBy} ${params.sortDir}
       LIMIT $${idx}`,
      values
    );

    const rows = result.rows;

    // ── JSON format ─────────────────────────────────────────────────────────
    if (format === 'json') {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="dlp-audit-${timestamp}.json"`
      );
      return res.status(200).json({
        exportedAt : new Date().toISOString(),
        rowCount   : rows.length,
        filters    : {
          minRisk       : params.minRisk,
          maxRisk       : params.maxRisk,
          style         : params.style,
          dateFrom      : params.dateFrom,
          dateTo        : params.dateTo,
          hasDetections : params.hasDetections,
        },
        records: rows.map(row => ({
          id             : row.id,
          createdAt      : row.created_at,
          riskScore      : row.risk_score,
          detectionCount : row.detection_count,
          maskStyle      : row.mask_style,
          categories     : extractCategories(row.detections),
          severities     : extractSeverities(row.detections),
          inputPreview   : truncate(row.input_text, 120),
          maskedPreview  : truncate(row.masked_text, 120),
          sourceIp       : row.source_ip,
        })),
      });
    }

    // ── CSV format ──────────────────────────────────────────────────────────

    // Build selected column definitions
    const selectedCols = params.columns
      .map(key => ALL_COLUMNS.find(c => c.key === key))
      .filter(Boolean);

    const headers = selectedCols.map(c => c.header);

    // Build CSV rows
    const csvRows = rows.map(row => {
      return selectedCols.map(col => {
        switch (col.key) {
          case 'id':
            return row.id;
          case 'created_at':
            return new Date(row.created_at).toISOString();
          case 'risk_score':
            return String(row.risk_score);
          case 'detection_count':
            return String(row.detection_count);
          case 'mask_style':
            return row.mask_style ?? '';
          case 'categories':
            return extractCategories(row.detections);
          case 'severities':
            return extractSeverities(row.detections);
          case 'input_preview':
            return truncate(row.input_text, 120);
          case 'masked_preview':
            return truncate(row.masked_text, 120);
          case 'source_ip':
            return row.source_ip ?? '';
          default:
            return '';
        }
      });
    });

    const csvContent = buildCSV(headers, csvRows);

    // ── Stream response ─────────────────────────────────────────────────────
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename  = `dlp-audit-${timestamp}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Row-Count', String(rows.length));

    // UTF-8 BOM — ensures Excel opens the file correctly on all platforms
    res.write('\uFEFF');
    res.end(csvContent);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/export/columns ───────────────────────────────────────────────────
//
// Returns the list of available export columns so the frontend
// can build the column selector without hardcoding.

router.get('/columns', (req, res) => {
  return res.status(200).json({
    success : true,
    data    : {
      columns        : ALL_COLUMNS,
      defaultColumns : DEFAULT_COLUMNS,
    },
  });
});

module.exports = router;