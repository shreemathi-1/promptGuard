const express = require('express');
const { runDetection, DETECTION_MODES } = require('../services/detectionPipeline');
const { validate } = require('../middleware/validate');
const { writeAuditLog, extractIp } = require('../services/auditLogger');
const { scanFiles, maskPreview } = require('../services/batchScanner');

const router = express.Router();

const MAX_INPUT_LENGTH = 50_000;

/**
 * POST /api/scan
 *
 * Body:
 * {
 *   text: string
 *   mode: 'REGEX' | 'AI' | 'HYBRID'  (optional, default: detection_mode setting)
 * }
 */
router.post(
  '/',
  validate((req) => {
    const { text, mode } = req.body;

    if (text === undefined || text === null) {
      return '"text" field is required';
    }
    if (typeof text !== 'string') {
      return '"text" must be a string';
    }
    if (text.trim().length === 0) {
      return '"text" must not be empty';
    }
    if (text.length > MAX_INPUT_LENGTH) {
      return `"text" exceeds maximum length of ${MAX_INPUT_LENGTH} characters`;
    }
    if (mode !== undefined && !DETECTION_MODES.includes(mode)) {
      return `"mode" must be one of: ${DETECTION_MODES.join(', ')}`;
    }
  }),
  async (req, res, next) => {
    try {
      const { text, mode } = req.body;

      // Scan honours the sensitivity_level setting; Mask and Rewrite never hide findings
      const result = await runDetection(text, { mode, applySensitivity: true });

      // ── Audit log (non-blocking) ────────────────────────────────────────
      writeAuditLog({
        inputText  : text,
        maskedText : null,
        detections : result.detections,
        maskStyle  : null,
        sourceIp   : extractIp(req),
        userAgent  : req.headers['user-agent'] || null,
        detectionMode    : result.effectiveMode,
        injectionScore   : result.injection?.score ?? null,
        aiDetectionCount : result.aiDetectionCount,
      }).catch((err) => {
        console.error('[AuditLogger] Failed to write scan log:', err.message);
      });
      // ────────────────────────────────────────────────────────────────────

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/scan/batch ──────────────────────────────────────────────────────
//
// Scans many files at once — used by the CLI, the git pre-commit hook, CI and
// the VS Code extension. Each finding has a line / column and a masked preview.
//
// Body:
// {
//   files: [{ path: string, content: string }]   (1–200 files, ≤ 1 MB each, ≤ 5 MB total)
//   mode?: 'REGEX' | 'AI' | 'HYBRID'
// }
//
// Response data:
// {
//   files: [{ path, findings: [{ line, column, category, severity, patternName,
//             source, confidence, preview, start, end }], riskScore, riskLevel,
//             effectiveMode, regexOnly, fellBack }],
//   summary: { filesScanned, filesWithFindings, findings, bySeverity,
//              highestSeverity, filesFellBack, filesRegexOnly, durationMs }
// }

const BATCH_MAX_FILES      = 200;
const BATCH_MAX_FILE_CHARS = 1_000_000;
const BATCH_MAX_TOTAL      = 5_000_000;

router.post(
  '/batch',
  validate((req) => {
    const { files, mode } = req.body;
    if (!Array.isArray(files) || files.length === 0) return '"files" must be a non-empty array';
    if (files.length > BATCH_MAX_FILES) return `"files" can have at most ${BATCH_MAX_FILES} entries`;
    let total = 0;
    for (const [i, f] of files.entries()) {
      if (!f || typeof f.path !== 'string' || !f.path || f.path.length > 500) {
        return `files[${i}].path must be a non-empty string (max 500 characters)`;
      }
      if (typeof f.content !== 'string') return `files[${i}].content must be a string`;
      if (f.content.length > BATCH_MAX_FILE_CHARS) return `${f.path} is larger than ${BATCH_MAX_FILE_CHARS} characters`;
      total += f.content.length;
    }
    if (total > BATCH_MAX_TOTAL) return `the batch is larger than ${BATCH_MAX_TOTAL} characters; split it`;
    if (mode !== undefined && !DETECTION_MODES.includes(mode)) {
      return `"mode" must be one of: ${DETECTION_MODES.join(', ')}`;
    }
  }),
  async (req, res, next) => {
    try {
      const files = req.body.files.filter((f) => f.content.trim().length > 0);
      const result = await scanFiles(files, { mode: req.body.mode });

      // Audit only files with findings, and only masked previews: the audit log
      // must not become a second copy of the secrets it found
      for (const file of result.files) {
        if (file.findings.length === 0) continue;
        const summary = file.findings
          .map((f) => `${file.path}:${f.line}:${f.column} ${f.category} ${f.preview}`)
          .join('\n');
        writeAuditLog({
          inputText  : `[batch scan]\n${summary}`,
          maskedText : null,
          detections : file._detections.map((d) => ({ ...d, match: maskPreview(d.match) })),
          maskStyle  : null,
          sourceIp   : extractIp(req),
          userAgent  : req.headers['user-agent'] || null,
          detectionMode    : file.effectiveMode,
          injectionScore   : null,
          aiDetectionCount : file._detections.filter((d) => d.source === 'AI').length,
        }).catch((err) => {
          console.error('[AuditLogger] Failed to write batch log:', err.message);
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          files   : result.files.map(({ _detections, ...rest }) => rest),
          summary : result.summary,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;