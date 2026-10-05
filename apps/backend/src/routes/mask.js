const express = require('express');
const { runDetection, DETECTION_MODES } = require('../services/detectionPipeline');
const { mask, MASK_STYLES } = require('../services/masker');
const { validate } = require('../middleware/validate');
const { writeAuditLog, extractIp } = require('../services/auditLogger');

const router = express.Router();

const MAX_INPUT_LENGTH = 50_000;
const VALID_STYLES = Object.values(MASK_STYLES);

/**
 * POST /api/mask
 *
 * Body:
 * {
 *   text:  string
 *   style: string  (optional, default: REDACT)
 *   mode:  string  (optional, REGEX | AI | HYBRID, default: detection_mode setting)
 * }
 */
router.post(
  '/',
  validate((req) => {
    const { text, style, mode } = req.body;

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
    if (style !== undefined && !VALID_STYLES.includes(style)) {
      return `"style" must be one of: ${VALID_STYLES.join(', ')}`;
    }
    if (mode !== undefined && !DETECTION_MODES.includes(mode)) {
      return `"mode" must be one of: ${DETECTION_MODES.join(', ')}`;
    }
  }),
  async (req, res, next) => {
    try {
      const { text, style = MASK_STYLES.REDACT, mode } = req.body;

      const startTime = Date.now();

      // Step 1 — Detect
      const scanResult = await runDetection(text, { mode });

      // Step 2 — Mask
      const maskResult = mask(text, scanResult.detections, style);

      const durationMs = Date.now() - startTime;

      // ── Audit log (non-blocking) ────────────────────────────────────────
      writeAuditLog({
        inputText  : text,
        maskedText : maskResult.maskedText,
        detections : scanResult.detections,
        maskStyle  : style,
        sourceIp   : extractIp(req),
        userAgent  : req.headers['user-agent'] || null,
        detectionMode    : scanResult.effectiveMode,
        injectionScore   : scanResult.injection?.score ?? null,
        aiDetectionCount : scanResult.aiDetectionCount,
      }).catch((err) => {
        console.error('[AuditLogger] Failed to write mask log:', err.message);
      });
      // ────────────────────────────────────────────────────────────────────

      return res.status(200).json({
        success: true,
        data: {
          originalText   : text,
          maskedText     : maskResult.maskedText,
          style          : maskResult.style,
          maskedCount    : maskResult.maskedCount,
          detectionCount : scanResult.detectionCount,
          replacements   : maskResult.replacements,
          detections     : scanResult.detections,
          scannedAt      : scanResult.scannedAt,
          durationMs,
          mode           : scanResult.mode,
          effectiveMode  : scanResult.effectiveMode,
          aiAvailable    : scanResult.aiAvailable,
          aiDetectionCount : scanResult.aiDetectionCount,
          filteredCount  : scanResult.filteredCount,
          injection      : scanResult.injection,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;