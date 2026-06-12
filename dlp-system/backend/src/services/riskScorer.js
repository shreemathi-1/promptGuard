/**
 * DLP Risk Scoring Engine
 *
 * Produces a 0–100 integer risk score from a detections array.
 *
 * Algorithm (three layers):
 *
 * 1. BASE SCORE
 *    Each detection contributes a base weight by severity:
 *      CRITICAL = 40  |  HIGH = 20  |  MEDIUM = 10  |  LOW = 5
 *
 * 2. CATEGORY MULTIPLIER
 *    Certain categories carry higher inherent risk:
 *      SSN, PASSPORT              → ×1.5
 *      CREDIT_CARD, BANK_ACCOUNT  → ×1.3
 *      API_KEY                    → ×1.2
 *      PHONE, EMAIL, CUSTOM       → ×1.0
 *
 * 3. COUNT ESCALATION
 *    Multiple detections of the same category signal a systemic leak:
 *      1 detection              → ×1.0
 *      2–3 detections           → ×1.2
 *      4–6 detections           → ×1.4
 *      7+ detections            → ×1.6
 *
 * Final score = min(sum of adjusted weights, 100)
 *
 * Additionally produces a breakdown object for UI visualisation.
 */

// ── Weights & multipliers ─────────────────────────────────────────────────────

const SEVERITY_BASE = {
  CRITICAL : 40,
  HIGH     : 20,
  MEDIUM   : 10,
  LOW      :  5,
};

const CATEGORY_MULTIPLIER = {
  SSN          : 1.5,
  PASSPORT     : 1.5,
  CREDIT_CARD  : 1.3,
  BANK_ACCOUNT : 1.3,
  API_KEY      : 1.2,
  PHONE        : 1.0,
  EMAIL        : 1.0,
  CUSTOM       : 1.0,
};

function getCountMultiplier(count) {
  if (count >= 7) return 1.6;
  if (count >= 4) return 1.4;
  if (count >= 2) return 1.2;
  return 1.0;
}

// ── Risk level thresholds ─────────────────────────────────────────────────────

const RISK_LEVELS = [
  { min: 80, label: 'CRITICAL', color: '#ef4444' },
  { min: 50, label: 'HIGH',     color: '#f97316' },
  { min: 20, label: 'MEDIUM',   color: '#f59e0b' },
  { min:  1, label: 'LOW',      color: '#22c55e' },
  { min:  0, label: 'NONE',     color: '#6b7280' },
];

function getRiskLevel(score) {
  return RISK_LEVELS.find(l => score >= l.min) ?? RISK_LEVELS[RISK_LEVELS.length - 1];
}

// ── Core scoring function ─────────────────────────────────────────────────────

/**
 * Calculates a risk score and full breakdown from a detections array.
 *
 * @param {Detection[]} detections
 * @returns {ScoreResult}
 *
 * ScoreResult shape:
 * {
 *   score:       number,         // 0–100 integer
 *   level:       string,         // NONE | LOW | MEDIUM | HIGH | CRITICAL
 *   color:       string,         // hex color for the level
 *   breakdown: {
 *     byCategory: CategoryBreakdown[],
 *     bySeverity: SeverityBreakdown[],
 *     totalDetections: number,
 *   }
 * }
 *
 * CategoryBreakdown shape:
 * {
 *   category:     string,
 *   count:        number,
 *   contribution: number,  // raw points this category contributed
 *   multiplier:   number,
 *   topSeverity:  string,
 * }
 *
 * SeverityBreakdown shape:
 * {
 *   severity:  string,
 *   count:     number,
 *   basePoints: number,
 * }
 */
function calculateRiskScore(detections) {
  if (!Array.isArray(detections) || detections.length === 0) {
    return {
      score     : 0,
      level     : 'NONE',
      color     : '#6b7280',
      breakdown : {
        byCategory      : [],
        bySeverity      : [],
        totalDetections : 0,
      },
    };
  }

  // ── Group detections by category ─────────────────────────────────────────
  const categoryGroups = {};
  for (const d of detections) {
    const cat = d.category ?? 'CUSTOM';
    if (!categoryGroups[cat]) {
      categoryGroups[cat] = { detections: [], count: 0 };
    }
    categoryGroups[cat].detections.push(d);
    categoryGroups[cat].count++;
  }

  // ── Group detections by severity ──────────────────────────────────────────
  const severityGroups = {};
  for (const d of detections) {
    const sev = d.severity ?? 'LOW';
    if (!severityGroups[sev]) {
      severityGroups[sev] = { count: 0, basePoints: 0 };
    }
    severityGroups[sev].count++;
    severityGroups[sev].basePoints += SEVERITY_BASE[sev] ?? 5;
  }

  // ── Calculate per-category contribution ──────────────────────────────────
  const SEVERITY_RANK = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

  let rawTotal = 0;
  const byCategory = [];

  for (const [category, group] of Object.entries(categoryGroups)) {
    const catMultiplier   = CATEGORY_MULTIPLIER[category] ?? 1.0;
    const countMultiplier = getCountMultiplier(group.count);

    // Sum base severity weights for this category's detections
    const baseSum = group.detections.reduce(
      (sum, d) => sum + (SEVERITY_BASE[d.severity] ?? 5),
      0
    );

    const contribution = baseSum * catMultiplier * countMultiplier;

    // Find top severity in this category
    const topSeverity = group.detections
      .sort((a, b) =>
        (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0)
      )[0].severity;

    byCategory.push({
      category,
      count        : group.count,
      contribution : Math.round(contribution * 10) / 10,
      multiplier   : Math.round(catMultiplier * countMultiplier * 10) / 10,
      topSeverity,
    });

    rawTotal += contribution;
  }

  // Sort byCategory: highest contribution first
  byCategory.sort((a, b) => b.contribution - a.contribution);

  // ── Build bySeverity breakdown ────────────────────────────────────────────
  const bySeverity = Object.entries(severityGroups)
    .map(([severity, data]) => ({
      severity,
      count      : data.count,
      basePoints : data.basePoints,
    }))
    .sort((a, b) =>
      (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0)
    );

  // ── Final score ───────────────────────────────────────────────────────────
  const score    = Math.min(Math.round(rawTotal), 100);
  const level    = getRiskLevel(score);

  return {
    score,
    level     : level.label,
    color     : level.color,
    breakdown : {
      byCategory,
      bySeverity,
      totalDetections : detections.length,
    },
  };
}

module.exports = { calculateRiskScore, getRiskLevel, RISK_LEVELS };