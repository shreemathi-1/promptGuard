const { query } = require('../config/db');
const { findMatches, deduplicateMatches, sortDetections } = require('./scanner');
const mlClient = require('./mlClient');

/**
 * Detection pipeline — regex rules + local AI.
 *
 * Modes:
 *   REGEX  — regex rules only (the original behaviour)
 *   AI     — ML entity detection only (Presidio + HuggingFace NER)
 *   HYBRID — regex hits scored by the ML validator (checksums + context),
 *            low-confidence hits dropped, AI entities (names, places, ...) added
 *
 * If the ML service is down, every mode falls back to REGEX and the result
 * says aiAvailable: false.
 *
 * Each detection keeps the scanner's shape (so masker.js works unchanged) and adds:
 *   source     : 'REGEX' | 'AI' | 'HYBRID'  (HYBRID = regex hit verified by the validator)
 *   confidence : number 0–1, or null when nothing scored it
 */

const DETECTION_MODES = ['REGEX', 'AI', 'HYBRID'];

const DEFAULT_SETTINGS = {
  mode          : 'HYBRID',
  threshold     : 0.6,
  injectionCheck: true,
};

const AI_PATTERN_NAMES = {
  PERSON       : 'Person Name',
  LOCATION     : 'Location',
  ORGANIZATION : 'Organization',
  DATE_OF_BIRTH: 'Date of Birth',
  MEDICAL      : 'Medical Condition',
};

async function loadDetectionSettings() {
  try {
    const result = await query(
      `SELECT key, value FROM settings WHERE key = ANY($1)`,
      [['detection_mode', 'ai_confidence_threshold', 'injection_check']]
    );
    const values = Object.fromEntries(result.rows.map((r) => [r.key, r.value]));
    const threshold = parseFloat(values.ai_confidence_threshold);

    return {
      mode          : DETECTION_MODES.includes(values.detection_mode) ? values.detection_mode : DEFAULT_SETTINGS.mode,
      threshold     : Number.isFinite(threshold) ? threshold : DEFAULT_SETTINGS.threshold,
      injectionCheck: values.injection_check !== undefined ? values.injection_check === 'true' : DEFAULT_SETTINGS.injectionCheck,
    };
  } catch (err) {
    console.error('[Pipeline] Failed to load settings, using defaults:', err.message);
    return { ...DEFAULT_SETTINGS };
  }
}

function fromAiEntity(entity) {
  return {
    patternId  : null,
    patternName: AI_PATTERN_NAMES[entity.category] ?? `${entity.category} (AI)`,
    category   : entity.category,
    severity   : entity.severity,
    match      : entity.match,
    start      : entity.start,
    end        : entity.end,
    length     : entity.end - entity.start,
    source     : 'AI',
    confidence : entity.confidence,
    recognizer : entity.recognizer,
  };
}

/**
 * Scores regex hits with the ML validator and splits them into kept / filtered.
 */
function applyValidation(matches, validation, threshold) {
  const kept = [];
  const filtered = [];

  for (const r of validation.results) {
    const hit = {
      ...matches[r.index],
      source    : 'HYBRID',
      confidence: r.confidence,
      reasons   : r.reasons,
    };
    (r.confidence >= threshold ? kept : filtered).push(hit);
  }

  return { kept, filtered };
}

function valueOf(settled) {
  return settled.status === 'fulfilled' ? settled.value : null;
}

/**
 * Runs detection on text.
 *
 * @param {string} text
 * @param {{ mode?: string, threshold?: number, injectionCheck?: boolean }} [overrides]
 *        Per-request overrides; anything omitted comes from the settings table.
 * @returns {Promise<DetectionResult>}
 *
 * DetectionResult = scanner's ScanResult plus:
 * {
 *   mode, effectiveMode, aiAvailable, threshold,
 *   aiDetectionCount, filteredCount, filtered,
 *   injection: { score, label, isInjection, model } | null,
 * }
 */
async function runDetection(text, overrides = {}) {
  const startTime = Date.now();
  const settings = await loadDetectionSettings();
  const mode = overrides.mode ?? settings.mode;
  const threshold = overrides.threshold ?? settings.threshold;
  const injectionCheck = overrides.injectionCheck ?? settings.injectionCheck;

  const { matches, patternCount } = await findMatches(text);

  const wantValidation = mode === 'HYBRID' && matches.length > 0;
  const wantDetect = mode !== 'REGEX';

  // ML calls are independent, so run them side by side
  const [validation, detection, injection] = await Promise.allSettled([
    wantValidation ? mlClient.validate(text, matches.map(({ category, match, start, end }) => ({ category, match, start, end }))) : null,
    wantDetect ? mlClient.detect(text, { entities: mode === 'AI' ? 'all' : 'ai', threshold }) : null,
    injectionCheck ? mlClient.injection(text) : null,
  ]);

  const failures = [validation, detection, injection].filter((s) => s.status === 'rejected');
  for (const f of failures) {
    console.warn('[Pipeline] ML call failed, degrading:', f.reason?.message);
  }

  const detectionFailed = validation.status === 'rejected' || detection.status === 'rejected';
  const attemptedAny = wantValidation || wantDetect || injectionCheck;
  const aiAvailable = attemptedAny
    ? failures.length === 0
    : mlClient.isEnabled() && !mlClient.isCircuitOpen();

  const effectiveMode = detectionFailed ? 'REGEX' : mode;
  let candidates = [];
  let filtered = [];

  if (effectiveMode === 'REGEX') {
    candidates = matches.map((m) => ({ ...m, source: 'REGEX', confidence: null }));
  } else {
    if (effectiveMode === 'HYBRID' && wantValidation) {
      ({ kept: candidates, filtered } = applyValidation(matches, valueOf(validation), threshold));
    }
    candidates.push(...valueOf(detection).entities.map(fromAiEntity));
  }

  const detections = sortDetections(deduplicateMatches(candidates));
  const injectionResult = valueOf(injection);

  return {
    detections,
    detectionCount  : detections.length,
    scannedAt       : new Date().toISOString(),
    patternCount,
    durationMs      : Date.now() - startTime,
    mode,
    effectiveMode,
    aiAvailable,
    threshold,
    aiDetectionCount: detections.filter((d) => d.source === 'AI').length,
    filteredCount   : filtered.length,
    filtered,
    injection       : injectionResult && {
      score      : injectionResult.score,
      label      : injectionResult.label,
      isInjection: injectionResult.isInjection,
      model      : injectionResult.model,
    },
  };
}

module.exports = { runDetection, loadDetectionSettings, DETECTION_MODES };
