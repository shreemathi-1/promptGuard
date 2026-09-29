const { query } = require('../config/db');

/**
 * In-memory pattern cache.
 * Patterns are loaded from DB once and cached.
 * Call reloadPatterns() to refresh after DB changes.
 */
let patternCache = [];
let cacheLoadedAt = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Loads all active patterns from DB and compiles regex objects.
 * Uses cache if still fresh.
 */
async function loadPatterns() {
  const now = Date.now();

  if (
    patternCache.length > 0 &&
    cacheLoadedAt &&
    now - cacheLoadedAt < CACHE_TTL_MS
  ) {
    return patternCache;
  }

  const result = await query(
    `SELECT id, name, description, pattern, category, severity
     FROM scan_patterns
     WHERE is_active = TRUE
     ORDER BY severity DESC, category ASC`,
    []
  );

  patternCache = result.rows.map((row) => {
    let compiled = null;
    let compileError = null;

    try {
      compiled = new RegExp(row.pattern, 'gi');
    } catch (err) {
      compileError = err.message;
      console.error(`[Scanner] Failed to compile pattern "${row.name}": ${err.message}`);
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      category: row.category,
      severity: row.severity,
      rawPattern: row.pattern,
      regex: compiled,
      compileError,
    };
  });

  cacheLoadedAt = now;
  console.log(`[Scanner] Loaded ${patternCache.length} patterns from DB`);
  return patternCache;
}

/**
 * Forces pattern cache to reload on next scan.
 * Call this after adding/updating/deleting patterns.
 */
function reloadPatterns() {
  patternCache = [];
  cacheLoadedAt = null;
}

/**
 * Severity rank for sorting detections.
 */
const SEVERITY_RANK = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

/**
 * Deduplicates overlapping matches.
 * If two matches overlap in position, keeps the higher-severity one.
 * @param {Array} matches - Raw match array
 * @returns {Array} - Deduplicated matches
 */
function deduplicateMatches(matches) {
  if (matches.length === 0) return [];

  // Sort by start index, then by severity descending
  const sorted = [...matches].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0);
  });

  const deduped = [];
  let lastEnd = -1;

  for (const match of sorted) {
    if (match.start >= lastEnd) {
      deduped.push(match);
      lastEnd = match.end;
    }
    // Overlapping match — skip (lower severity or same position)
  }

  return deduped;
}

/**
 * Core scan function.
 * Runs all active patterns against the input text.
 *
 * @param {string} text - Raw input text to scan
 * @returns {Promise<ScanResult>}
 *
 * ScanResult shape:
 * {
 *   detections: Array<Detection>,
 *   detectionCount: number,
 *   scannedAt: string (ISO),
 *   patternCount: number,
 *   durationMs: number,
 * }
 *
 * Detection shape:
 * {
 *   patternId: string,
 *   patternName: string,
 *   category: string,
 *   severity: string,
 *   match: string,        ← actual matched text
 *   start: number,        ← char index in original text
 *   end: number,
 *   length: number,
 * }
 */
async function scan(text) {
  if (typeof text !== 'string') {
    throw new TypeError('[Scanner] Input must be a string');
  }

  if (text.trim().length === 0) {
    return {
      detections: [],
      detectionCount: 0,
      scannedAt: new Date().toISOString(),
      patternCount: 0,
      durationMs: 0,
    };
  }

  const startTime = Date.now();
  const patterns = await loadPatterns();
  const rawMatches = [];

  for (const p of patterns) {
    if (!p.regex) continue; // skip patterns that failed to compile

    // Reset lastIndex — critical for 'g' flag regexes reused across calls
    p.regex.lastIndex = 0;

    let match;
    while ((match = p.regex.exec(text)) !== null) {
      const matchedValue = match[0];

      rawMatches.push({
        patternId: p.id,
        patternName: p.name,
        category: p.category,
        severity: p.severity,
        match: matchedValue,
        start: match.index,
        end: match.index + matchedValue.length,
        length: matchedValue.length,
      });

      // Prevent infinite loop on zero-length matches
      if (match.index === p.regex.lastIndex) {
        p.regex.lastIndex++;
      }
    }

    // Always reset after use
    p.regex.lastIndex = 0;
  }

  const detections = deduplicateMatches(rawMatches);

  // Sort final result: severity DESC, then position ASC
  detections.sort((a, b) => {
    const rankDiff =
      (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0);
    return rankDiff !== 0 ? rankDiff : a.start - b.start;
  });

  return {
    detections,
    detectionCount: detections.length,
    scannedAt: new Date().toISOString(),
    patternCount: patterns.length,
    durationMs: Date.now() - startTime,
  };
}

module.exports = { scan, loadPatterns, reloadPatterns };