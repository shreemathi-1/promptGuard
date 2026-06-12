const express = require('express');
const { scan } = require('../services/scanner');
const { mask, MASK_STYLES } = require('../services/masker');
const { validate } = require('../middleware/validate');
const { writeAuditLog, extractIp } = require('../services/auditLogger'); // ← ADD

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
 * }
 */
router.post(
  '/',
  validate((req) => {
    const { text, style } = req.body;

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
  }),
  async (req, res, next) => {
    try {
      const { text, style = MASK_STYLES.REDACT } = req.body;

      const startTime = Date.now();

      // Step 1 — Detect
      const scanResult = await scan(text);

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
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;