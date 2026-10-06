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
 *      MEDICAL                    → ×1.5   (AI-detected)
 *      DATE_OF_BIRTH              → ×1.2   (AI-detected)
 *      PERSON                     → ×1.0   (AI-detected)
 *      LOCATION, ORGANIZATION     → ×0.8   (AI-detected)
 *
 *    Each detection's weight is scaled by its confidence (0–1) when it has
 *    one; regex-only detections count in full.
 *
 * 3. COUNT ESCALATION
 *    Multiple detections of the same category signal a systemic leak:
 *      1 detection              → ×1.0
 *      2–3 detections           → ×1.2
 *      4–6 detections           → ×1.4
 *      7+ detections            → ×1.6
 *
 * 4. PROMPT INJECTION
 *    An injection probability ≥ 0.5 adds up to 40 points; above 0.9 the
 *    score is raised to at least 80 (CRITICAL).
 *
 * Final score = min(sum of adjusted weights + injection points, 100)
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
  MEDICAL      : 1.5,
  DATE_OF_BIRTH: 1.2,
  PERSON       : 1.0,
  LOCATION     : 0.8,
  ORGANIZATION : 0.8,
};

const INJECTION_MIN_SCORE      = 0.5;
const INJECTION_MAX_POINTS     = 40;
const INJECTION_CRITICAL_SCORE = 0.9;
const CRITICAL_FLOOR           = 80;

function getInjectionPoints(injectionScore) {
  if (typeof injectionScore !== 'number' || injectionScore < INJECTION_MIN_SCORE) return 0;
  return Math.round(INJECTION_MAX_POINTS * injectionScore);
}

function detectionWeight(d) {
  const confidence = typeof d.confidence === 'number' ? d.confidence : 1;
  return (SEVERITY_BASE[d.severity] ?? 5) * confidence;
}

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
 * @param {{ injectionScore?: number|null }} [options]  prompt-injection probability (0–1)
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
 *     injection: { score: number, points: number } | null,
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
function calculateRiskScore(detections, { injectionScore = null } = {}) {
  const injectionPoints = getInjectionPoints(injectionScore);
  const injection = typeof injectionScore === 'number'
    ? { score: injectionScore, points: injectionPoints }
    : null;

  if (!Array.isArray(detections)) detections = [];

  if (detections.length === 0 && injectionPoints === 0) {
    return {
      score     : 0,
      level     : 'NONE',
      color     : '#6b7280',
      breakdown : {
        byCategory      : [],
        bySeverity      : [],
        totalDetections : 0,
        injection,
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

    // Sum severity weights (scaled by confidence) for this category's detections
    const baseSum = group.detections.reduce((sum, d) => sum + detectionWeight(d), 0);

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
  let score = Math.min(Math.round(rawTotal + injectionPoints), 100);
  if (typeof injectionScore === 'number' && injectionScore > INJECTION_CRITICAL_SCORE) {
    score = Math.max(score, CRITICAL_FLOOR);
  }

  const level    = getRiskLevel(score);

  return {
    score,
    level     : level.label,
    color     : level.color,
    breakdown : {
      byCategory,
      bySeverity,
      totalDetections : detections.length,
      injection,
    },
  };
}

module.exports = { calculateRiskScore, getRiskLevel, RISK_LEVELS, INJECTION_MIN_SCORE };