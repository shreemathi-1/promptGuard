const express = require('express');
const { scan } = require('../services/scanner');
const { validate } = require('../middleware/validate');
const { writeAuditLog, extractIp } = require('../services/auditLogger'); // ← ADD

const router = express.Router();

const MAX_INPUT_LENGTH = 50_000;

/**
 * POST /api/scan
 *
 * Body:
 * {
 *   text: string
 * }
 */
router.post(
  '/',
  validate((req) => {
    const { text } = req.body;

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
  }),
  async (req, res, next) => {
    try {
      const { text } = req.body;

      const result = await scan(text);

      // ── Audit log (non-blocking) ────────────────────────────────────────
      writeAuditLog({
        inputText  : text,
        maskedText : null,
        detections : result.detections,
        maskStyle  : null,
        sourceIp   : extractIp(req),
        userAgent  : req.headers['user-agent'] || null,
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