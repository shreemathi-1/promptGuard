const crypto = require('crypto');

/**
 * Masking style behaviours:
 *
 * REDACT   — replaces entire match with a category label
 *            e.g. "4111 1111 1111 1111" → "[CREDIT_CARD REDACTED]"
 *
 * PARTIAL  — reveals only the last 4 characters, masks the rest with *
 *            e.g. "4111 1111 1111 1111" → "***************1111"
 *            For short values (≤ 4 chars) everything is masked.
 *
 * TOKENIZE — replaces match with a deterministic UUID token
 *            e.g. "4111 1111 1111 1111" → "[TOKEN:a1b2c3d4-...]"
 *            Same input always produces the same token (within a session).
 */

const MASK_STYLES = {
  REDACT: 'REDACT',
  PARTIAL: 'PARTIAL',
  TOKENIZE: 'TOKENIZE',
};

const DEFAULT_STYLE = MASK_STYLES.REDACT;

/**
 * In-memory token map for TOKENIZE style.
 * Maps original matched value → stable UUID token.
 * Intentionally session-scoped (resets on server restart).
 */
const tokenMap = new Map();

/**
 * Generates or retrieves a deterministic token for a matched value.
 * Uses SHA-256 of the value as the UUID source so the same value
 * always maps to the same token across calls.
 *
 * @param {string} value - The original sensitive value
 * @returns {string} - UUID-formatted token string
 */
function getToken(value) {
  if (tokenMap.has(value)) {
    return tokenMap.get(value);
  }

  const hash = crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');

  // Format first 32 hex chars as a UUID v4-like string
  const token = [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '4' + hash.slice(13, 16),   // version 4 indicator
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join('-');

  tokenMap.set(value, token);
  return token;
}

/**
 * Produces the replacement string for a single detection.
 *
 * @param {Detection} detection - Single detection object from scanner
 * @param {string} style        - REDACT | PARTIAL | TOKENIZE
 * @returns {string}            - Replacement string
 */
function buildReplacement(detection, style) {
  const { match, category } = detection;

  switch (style) {
    case MASK_STYLES.REDACT:
      return `[${category} REDACTED]`;

    case MASK_STYLES.PARTIAL: {
      const visible = 4;
      if (match.length <= visible) {
        return '*'.repeat(match.length);
      }
      const masked = '*'.repeat(match.length - visible);
      const revealed = match.slice(-visible);
      return `${masked}${revealed}`;
    }

    case MASK_STYLES.TOKENIZE: {
      const token = getToken(match);
      return `[TOKEN:${token}]`;
    }

    default:
      return `[${category} REDACTED]`;
  }
}

/**
 * Applies masking to the original text using detection positions.
 *
 * Strategy: iterate detections sorted by start position DESC
 * and splice replacements in from right to left so earlier
 * character indices remain valid throughout.
 *
 * @param {string}      text       - Original input text
 * @param {Detection[]} detections - Array from scanner result
 * @param {string}      style      - REDACT | PARTIAL | TOKENIZE
 * @returns {MaskResult}
 *
 * MaskResult shape:
 * {
 *   maskedText:    string,
 *   style:         string,
 *   replacements:  Replacement[],
 *   maskedCount:   number,
 * }
 *
 * Replacement shape:
 * {
 *   original:     string,
 *   replacement:  string,
 *   category:     string,
 *   severity:     string,
 *   start:        number,
 *   end:          number,
 * }
 */
function mask(text, detections, style = DEFAULT_STYLE) {
  if (typeof text !== 'string') {
    throw new TypeError('[Masker] text must be a string');
  }

  if (!Object.values(MASK_STYLES).includes(style)) {
    throw new RangeError(
      `[Masker] Invalid style "${style}". Must be one of: ${Object.values(MASK_STYLES).join(', ')}`
    );
  }

  if (!Array.isArray(detections) || detections.length === 0) {
    return {
      maskedText: text,
      style,
      replacements: [],
      maskedCount: 0,
    };
  }

  // Sort detections right-to-left by start position
  // so we can splice without shifting subsequent indices
  const sorted = [...detections].sort((a, b) => b.start - a.start);

  let maskedText = text;
  const replacements = [];

  for (const detection of sorted) {
    const { start, end, match, category, severity } = detection;

    // Guard: ensure positions are within current text bounds
    if (start < 0 || end > maskedText.length || start >= end) {
      console.warn(
        `[Masker] Skipping out-of-bounds detection: "${match}" at ${start}–${end}`
      );
      continue;
    }

    const replacement = buildReplacement(detection, style);

    maskedText =
      maskedText.slice(0, start) +
      replacement +
      maskedText.slice(end);

    replacements.push({
      original: match,
      replacement,
      category,
      severity,
      start,
      end,
    });
  }

  // Restore replacements to left-to-right order for readability
  replacements.sort((a, b) => a.start - b.start);

  return {
    maskedText,
    style,
    replacements,
    maskedCount: replacements.length,
  };
}

/**
 * Clears the in-memory token map.
 * Useful in tests or when you want fresh tokens.
 */
function clearTokenMap() {
  tokenMap.clear();
}

module.exports = { mask, buildReplacement, clearTokenMap, MASK_STYLES };