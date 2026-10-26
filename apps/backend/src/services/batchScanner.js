const { runDetection } = require('./detectionPipeline');
const { calculateRiskScore } = require('./riskScorer');

/**
 * Scans many files in one request (CLI, pre-commit hook, CI, VS Code).
 *
 * Differences from a single /api/scan:
 *   - no prompt-injection check: source files aren't prompts
 *   - files larger than the ML service accepts are scanned with regex rules only
 *   - each finding gets a line / column and a masked preview, so callers can
 *     print results (e.g. in public CI logs) without echoing the secret
 */

// The ML service rejects longer texts (MAX_TEXT_LENGTH)
const ML_MAX_CHARS = 50_000;
// The ML service is CPU-bound; more parallel requests only queue up there
const CONCURRENCY = 2;

// NER on a large source file can take several seconds. A slow answer isn't an
// outage, so batch calls get a long timeout and don't count toward the circuit
// breaker (which would otherwise push interactive web scans into regex-only mode).
const BATCH_ML_OPTIONS = { timeoutMs: 60_000, breaker: false };

const SEVERITY_RANK = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

/** "AKIAIOSFODNN7EXAMPLE" → "AKIA************MPLE"; short values are fully hidden. */
function maskPreview(value) {
  const v = value.replace(/\s+/g, ' ');
  if (v.length >= 12) return v.slice(0, 4) + '*'.repeat(v.length - 8) + v.slice(-4);
  if (v.length >= 6) return v.slice(0, 2) + '*'.repeat(v.length - 2);
  return '*'.repeat(v.length);
}

/** Offsets of the start of every line, for offset → line/column lookups. */
function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function position(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - starts[lo] + 1 };
}

async function scanFile(file, mode) {
  const regexOnly = file.content.length > ML_MAX_CHARS;
  const result = await runDetection(file.content, {
    mode          : regexOnly ? 'REGEX' : mode,
    injectionCheck: false,
    mlOptions     : BATCH_ML_OPTIONS,
  });

  const starts = lineStarts(file.content);
  const findings = result.detections.map((d) => ({
    ...position(starts, d.start),
    category   : d.category,
    severity   : d.severity,
    patternName: d.patternName,
    source     : d.source,
    confidence : d.confidence,
    preview    : maskPreview(d.match),
    start      : d.start,
    end        : d.end,
  }));

  const risk = calculateRiskScore(result.detections);
  return {
    path          : file.path,
    findings,
    riskScore     : risk.score,
    riskLevel     : risk.level,
    effectiveMode : result.effectiveMode,
    regexOnly,
    // AI was wanted for this file but the ML service didn't answer
    fellBack      : !regexOnly && result.mode !== 'REGEX' && result.effectiveMode === 'REGEX',
    // kept for the audit log (masked), never returned
    _detections   : result.detections,
  };
}

/**
 * @param {{ path: string, content: string }[]} files
 * @param {{ mode?: string }} [opts]
 */
async function scanFiles(files, { mode } = {}) {
  const startTime = Date.now();
  const results = new Array(files.length);
  let next = 0;

  // Small worker pool: keeps the ML service busy without flooding it
  async function worker() {
    while (next < files.length) {
      const i = next++;
      results[i] = await scanFile(files[i], mode);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));

  const bySeverity = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  let highest = null;
  for (const r of results) {
    for (const f of r.findings) {
      bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
      if (!highest || SEVERITY_RANK[f.severity] > SEVERITY_RANK[highest]) highest = f.severity;
    }
  }

  return {
    files   : results,
    summary : {
      filesScanned       : results.length,
      filesWithFindings  : results.filter((r) => r.findings.length > 0).length,
      findings           : results.reduce((n, r) => n + r.findings.length, 0),
      bySeverity,
      highestSeverity    : highest,
      filesFellBack      : results.filter((r) => r.fellBack).length,
      filesRegexOnly     : results.filter((r) => r.regexOnly).length,
      durationMs         : Date.now() - startTime,
    },
  };
}

module.exports = { scanFiles, maskPreview, lineStarts, position, ML_MAX_CHARS };
