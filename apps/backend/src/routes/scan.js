const express = require('express');
const { runDetection, DETECTION_MODES } = require('../services/detectionPipeline');
const { validate } = require('../middleware/validate');
const { writeAuditLog, extractIp } = require('../services/auditLogger');

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

      const result = await runDetection(text, { mode });

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

module.exports = router;