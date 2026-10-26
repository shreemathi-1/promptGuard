const { query }              = require('../config/db');
const { calculateRiskScore } = require('./riskScorer');

/**
 * Writes a scan or mask event to the audit_logs table.
 *
 * @param {AuditEntry} entry
 * @returns {Promise<AuditRecord>}
 */
async function writeAuditLog(entry) {
  const {
    inputText,
    maskedText = null,
    detections = [],
    maskStyle  = null,
    sourceIp   = null,
    userAgent  = null,
    detectionMode    = null,
    injectionScore   = null,
    aiDetectionCount = 0,
  } = entry;

  if (typeof inputText !== 'string' || inputText.trim().length === 0) {
    throw new TypeError('[AuditLogger] inputText must be a non-empty string');
  }

  const detectionCount = detections.length;

  // Use the full risk scorer — store only the integer score in the DB
  const { score: riskScore } = calculateRiskScore(detections, { injectionScore });

  // Check log_input_text setting
  let textToStore = inputText;
  try {
    const setting = await query(
      `SELECT value FROM settings WHERE key = 'log_input_text'`,
      []
    );
    if (setting.rows[0]?.value === 'false') {
      textToStore = '[INPUT LOGGING DISABLED]';
    }
  } catch {
    // default to logging
  }

  const result = await query(
    `INSERT INTO audit_logs
      (input_text, masked_text, detection_count, detections,
       mask_style, risk_score, source_ip, user_agent,
       detection_mode, injection_score, ai_detection_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING
       id,
       input_text      AS "inputText",
       masked_text     AS "maskedText",
       detection_count AS "detectionCount",
       detections,
       mask_style      AS "maskStyle",
       risk_score      AS "riskScore",
       source_ip       AS "sourceIp",
       user_agent      AS "userAgent",
       detection_mode  AS "detectionMode",
       injection_score AS "injectionScore",
       ai_detection_count AS "aiDetectionCount",
       created_at      AS "createdAt"`,
    [
      textToStore,
      maskedText,
      detectionCount,
      JSON.stringify(detections),
      maskStyle,
      riskScore,
      sourceIp,
      userAgent,
      detectionMode,
      injectionScore,
      aiDetectionCount,
    ]
  );

  return result.rows[0];
}

/**
 * Extracts client IP from Express request.
 */
function extractIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || null;
}

module.exports = { writeAuditLog, extractIp };