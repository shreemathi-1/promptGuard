const express = require('express');
const { runDetection, DETECTION_MODES } = require('../services/detectionPipeline');
const mlClient = require('../services/mlClient');
const { validate } = require('../middleware/validate');
const { writeAuditLog, extractIp } = require('../services/auditLogger');

const router = express.Router();

const MAX_INPUT_LENGTH = 50_000;
const REWRITE_STYLE = 'PSEUDONYMIZE';

function textError(text) {
  if (text === undefined || text === null) return '"text" field is required';
  if (typeof text !== 'string') return '"text" must be a string';
  if (text.trim().length === 0) return '"text" must not be empty';
  if (text.length > MAX_INPUT_LENGTH) return `"text" exceeds maximum length of ${MAX_INPUT_LENGTH} characters`;
  return null;
}

function mappingIdError(mappingId, required) {
  if (mappingId === undefined || mappingId === null || mappingId === '') {
    return required ? '"mappingId" field is required' : null;
  }
  if (typeof mappingId !== 'string' || mappingId.length > 64) return '"mappingId" must be a string of at most 64 characters';
  return null;
}

/** Maps ML-service failures to API responses; returns true when handled. */
function sendMlError(res, err) {
  if (err instanceof mlClient.MlUnavailableError) {
    res.status(503).json({ success: false, error: 'Smart Rewrite needs the ML service, which is unavailable' });
    return true;
  }
  if (err.status === 404) {
    res.status(404).json({ success: false, error: 'Rewrite mapping not found or expired — rewrite the prompt again' });
    return true;
  }
  return false;
}

/**
 * POST /api/ai/rewrite
 *
 * Smart Rewrite: detects sensitive values and swaps each for a realistic fake
 * of the same type, so the prompt can go to a chatbot and still read naturally.
 * The original ↔ fake mapping stays in the ML service's memory (never the DB).
 *
 * Body: { text, mode?: 'REGEX'|'AI'|'HYBRID', mappingId?: string }
 *   mappingId — from an earlier rewrite, to keep the same fakes across prompts
 *
 * Response data:
 * {
 *   originalText, rewrittenText, mappingId, ttlSeconds,
 *   replacements: [{ category, original, fake, start, end, fakeStart, fakeEnd }],
 *   detections, detectionCount, mode, effectiveMode, aiAvailable, injection, durationMs
 * }
 */
router.post(
  '/rewrite',
  validate((req) => {
    const { text, mode, mappingId } = req.body;
    const err = textError(text) ?? mappingIdError(mappingId, false);
    if (err) return err;
    if (mode !== undefined && !DETECTION_MODES.includes(mode)) {
      return `"mode" must be one of: ${DETECTION_MODES.join(', ')}`;
    }
  }),
  async (req, res, next) => {
    try {
      const { text, mode, mappingId } = req.body;
      const startTime = Date.now();

      const scanResult = await runDetection(text, { mode });
      const entities = scanResult.detections.map(({ category, match, start, end }) => ({ category, match, start, end }));
      const rewrite = await mlClient.pseudonymize(text, entities, mappingId);

      writeAuditLog({
        inputText  : text,
        maskedText : rewrite.text,
        detections : scanResult.detections,
        maskStyle  : REWRITE_STYLE,
        sourceIp   : extractIp(req),
        userAgent  : req.headers['user-agent'] || null,
        detectionMode    : scanResult.effectiveMode,
        injectionScore   : scanResult.injection?.score ?? null,
        aiDetectionCount : scanResult.aiDetectionCount,
      }).catch((err) => {
        console.error('[AuditLogger] Failed to write rewrite log:', err.message);
      });

      return res.status(200).json({
        success: true,
        data: {
          originalText   : text,
          rewrittenText  : rewrite.text,
          mappingId      : rewrite.mappingId,
          ttlSeconds     : rewrite.ttlSeconds,
          replacements   : rewrite.replacements,
          detections     : scanResult.detections,
          detectionCount : scanResult.detectionCount,
          mode           : scanResult.mode,
          effectiveMode  : scanResult.effectiveMode,
          aiAvailable    : scanResult.aiAvailable,
          aiDetectionCount : scanResult.aiDetectionCount,
          filteredCount  : scanResult.filteredCount,
          injection      : scanResult.injection,
          durationMs     : Date.now() - startTime,
        },
      });
    } catch (err) {
      if (sendMlError(res, err)) return;
      next(err);
    }
  }
);

/**
 * POST /api/ai/restore
 *
 * Puts the original values back into a chatbot's reply.
 *
 * Body: { mappingId, text }
 * Response data: { text, restoredCount, restored: { [fake]: count } }
 */
router.post(
  '/restore',
  validate((req) => mappingIdError(req.body.mappingId, true) ?? textError(req.body.text)),
  async (req, res, next) => {
    try {
      const { mappingId, text } = req.body;
      const result = await mlClient.restore(mappingId, text);
      return res.status(200).json({
        success: true,
        data: {
          text          : result.text,
          restoredCount : result.restoredCount,
          restored      : result.restored,
        },
      });
    } catch (err) {
      if (sendMlError(res, err)) return;
      next(err);
    }
  }
);

/**
 * DELETE /api/ai/rewrite/:mappingId
 *
 * Forgets a mapping before its TTL ("I'm done with this conversation").
 */
router.delete('/rewrite/:mappingId', async (req, res, next) => {
  try {
    await mlClient.forgetMapping(req.params.mappingId);
    return res.status(200).json({ success: true, data: { deleted: true } });
  } catch (err) {
    if (sendMlError(res, err)) return;
    next(err);
  }
});

module.exports = router;
