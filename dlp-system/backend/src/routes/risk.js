const express = require('express');
const { query }              = require('../config/db');
const { calculateRiskScore } = require('../services/riskScorer');

const router = express.Router();

/**
 * GET /api/risk/summary
 *
 * Returns aggregate risk analytics across all audit_logs.
 *
 * Query params (optional):
 *   days  number  — look-back window in days (default 7, max 90)
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     window:          { days, from, to },
 *     totals:          { scans, detections, maskedOps },
 *     averageRisk:     number,
 *     riskDistribution: { CRITICAL, HIGH, MEDIUM, LOW, NONE },
 *     topCategories:   { category, count, percentage }[],
 *     topSeverities:   { severity, count }[],
 *     dailyTrend:      { date, scanCount, avgRisk, detectionCount }[],
 *     highestRiskEvents: AuditRecord[]  (top 5)
 *   }
 * }
 */
router.get('/summary', async (req, res, next) => {
  try {
    // ── Parse & validate `days` param ──────────────────────────────────────
    let days = parseInt(req.query.days, 10);
    if (isNaN(days) || days < 1)  days = 7;
    if (days > 90)                days = 90;

    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);
    fromDate.setHours(0, 0, 0, 0);
    const fromISO = fromDate.toISOString();
    const toISO   = new Date().toISOString();

    // ── Totals ───────────────────────────────────────────────────────────
    const totalsResult = await query(
      `SELECT
         COUNT(*)                                        AS total_scans,
         COALESCE(SUM(detection_count), 0)              AS total_detections,
         COUNT(*) FILTER (WHERE mask_style IS NOT NULL) AS masked_ops,
         COALESCE(AVG(risk_score), 0)                   AS avg_risk,
         COALESCE(MAX(risk_score), 0)                   AS max_risk
       FROM audit_logs
       WHERE created_at >= $1`,
      [fromISO]
    );

    const totals      = totalsResult.rows[0];
    const totalScans  = parseInt(totals.total_scans, 10);
    const avgRisk     = Math.round(parseFloat(totals.avg_risk) * 10) / 10;

    // ── Risk distribution ─────────────────────────────────────────────────
    const distResult = await query(
      `SELECT
         COUNT(*) FILTER (WHERE risk_score >= 80)                   AS critical_count,
         COUNT(*) FILTER (WHERE risk_score >= 50 AND risk_score < 80) AS high_count,
         COUNT(*) FILTER (WHERE risk_score >= 20 AND risk_score < 50) AS medium_count,
         COUNT(*) FILTER (WHERE risk_score >= 1  AND risk_score < 20) AS low_count,
         COUNT(*) FILTER (WHERE risk_score = 0)                     AS none_count
       FROM audit_logs
       WHERE created_at >= $1`,
      [fromISO]
    );

    const dist = distResult.rows[0];
    const riskDistribution = {
      CRITICAL : parseInt(dist.critical_count, 10),
      HIGH     : parseInt(dist.high_count,     10),
      MEDIUM   : parseInt(dist.medium_count,   10),
      LOW      : parseInt(dist.low_count,      10),
      NONE     : parseInt(dist.none_count,     10),
    };

    // ── Top categories from JSONB detections ──────────────────────────────
    const categoriesResult = await query(
      `SELECT
         d->>'category'   AS category,
         COUNT(*)::integer AS count
       FROM audit_logs,
            jsonb_array_elements(detections) AS d
       WHERE created_at >= $1
         AND detection_count > 0
       GROUP BY d->>'category'
       ORDER BY count DESC
       LIMIT 8`,
      [fromISO]
    );

    const totalDetectionCount = categoriesResult.rows.reduce(
      (sum, r) => sum + r.count, 0
    );

    const topCategories = categoriesResult.rows.map(r => ({
      category   : r.category,
      count      : r.count,
      percentage : totalDetectionCount > 0
        ? Math.round((r.count / totalDetectionCount) * 100)
        : 0,
    }));

    // ── Top severities from JSONB detections ──────────────────────────────
    const severitiesResult = await query(
      `SELECT
         d->>'severity'   AS severity,
         COUNT(*)::integer AS count
       FROM audit_logs,
            jsonb_array_elements(detections) AS d
       WHERE created_at >= $1
         AND detection_count > 0
       GROUP BY d->>'severity'
       ORDER BY count DESC`,
      [fromISO]
    );

    const topSeverities = severitiesResult.rows.map(r => ({
      severity : r.severity,
      count    : r.count,
    }));

    // ── Daily trend ───────────────────────────────────────────────────────
    const trendResult = await query(
      `SELECT
         DATE(created_at)                        AS date,
         COUNT(*)::integer                       AS scan_count,
         ROUND(AVG(risk_score)::numeric, 1)      AS avg_risk,
         COALESCE(SUM(detection_count), 0)::integer AS detection_count
       FROM audit_logs
       WHERE created_at >= $1
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      [fromISO]
    );

    // Fill in missing days with zero values
    const trendMap = {};
    for (const row of trendResult.rows) {
      trendMap[row.date] = {
        date           : row.date,
        scanCount      : row.scan_count,
        avgRisk        : parseFloat(row.avg_risk),
        detectionCount : row.detection_count,
      };
    }

    const dailyTrend = [];
    for (let i = days - 1; i >= 0; i--) {
      const d   = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split('T')[0];
      dailyTrend.push(
        trendMap[key] ?? {
          date           : key,
          scanCount      : 0,
          avgRisk        : 0,
          detectionCount : 0,
        }
      );
    }

    // ── Top 5 highest risk events ─────────────────────────────────────────
    const highRiskResult = await query(
      `SELECT
         id,
         input_text        AS "inputText",
         masked_text       AS "maskedText",
         detection_count   AS "detectionCount",
         detections,
         mask_style        AS "maskStyle",
         risk_score        AS "riskScore",
         source_ip         AS "sourceIp",
         created_at        AS "createdAt"
       FROM audit_logs
       WHERE created_at >= $1
         AND detection_count > 0
       ORDER BY risk_score DESC, created_at DESC
       LIMIT 5`,
      [fromISO]
    );

    return res.status(200).json({
      success : true,
      data    : {
        window : {
          days,
          from : fromISO,
          to   : toISO,
        },
        totals : {
          scans      : totalScans,
          detections : parseInt(totals.total_detections, 10),
          maskedOps  : parseInt(totals.masked_ops, 10),
          maxRisk    : parseInt(totals.max_risk, 10),
        },
        averageRisk      : avgRisk,
        riskDistribution,
        topCategories,
        topSeverities,
        dailyTrend,
        highestRiskEvents : highRiskResult.rows,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/risk/score
 *
 * Score a detections array on demand without creating an audit log.
 * Useful for the frontend to preview risk before committing.
 *
 * Body: { detections: Detection[] }
 *
 * Response:
 * {
 *   success: true,
 *   data: ScoreResult
 * }
 */
router.post('/score', (req, res) => {
  const { detections } = req.body;

  if (!Array.isArray(detections)) {
    return res.status(400).json({
      success : false,
      error   : '"detections" must be an array',
    });
  }

  const result = calculateRiskScore(detections);

  return res.status(200).json({
    success : true,
    data    : result,
  });
});

module.exports = router;