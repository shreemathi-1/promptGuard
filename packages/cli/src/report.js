/**
 * Turns scan results into a verdict and output.
 *
 * Inline suppression (like gitleaks:allow):
 *   const key = "AKIA…";  // promptguard:ignore
 *   // promptguard:ignore-next-line
 */

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const RANK = Object.fromEntries(SEVERITIES.map((s, i) => [s, i + 1]));

/**
 * Values published as examples in vendor docs and payment test suites. They
 * appear in tests, docs and demos everywhere and are never real secrets, so
 * (like gitleaks' allowlist) they don't count. --include-test-values turns this off.
 */
const KNOWN_TEST_VALUES = new Set([
  // AWS documentation example credentials
  'AKIAIOSFODNN7EXAMPLE', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  // Payment-network test cards (Visa, Mastercard, Amex, Discover, Stripe)
  '4111111111111111', '4242424242424242', '4012888888881881', '5555555555554444', '5105105105105100',
  '378282246310005', '371449635398431', '6011111111111117', '6011000990139424',
  // ISO 13616 / bank documentation example IBANs
  'GB29NWBK60161331926819', 'DE89370400440532013000', 'GB82WEST12345698765432',
]);

function normalise(value) {
  return value.replace(/[\s-]/g, '');
}

const IGNORE_LINE = 'promptguard:ignore';
const IGNORE_NEXT = 'promptguard:ignore-next-line';

function isIgnored(lines, lineNo) {
  const line = lines[lineNo - 1] ?? '';
  const previous = lines[lineNo - 2] ?? '';
  return (line.includes(IGNORE_LINE) && !line.includes(IGNORE_NEXT)) || previous.includes(IGNORE_NEXT);
}

/**
 * Drops findings suppressed by inline comments and splits the rest by the
 * fail-on threshold.
 *
 * @param {object[]} fileResults — files[] from the API
 * @param {{ path: string, content: string }[]} sources
 * @param {string} failOn — LOW | MEDIUM | HIGH | CRITICAL
 */
function evaluate(fileResults, sources, failOn, { allowTestValues = true } = {}) {
  const contentByPath = new Map(sources.map((s) => [s.path, s.content]));
  const threshold = RANK[failOn];
  let ignored = 0;
  let testValues = 0;

  const files = fileResults.map((f) => {
    const content = contentByPath.get(f.path) ?? '';
    const lines = content.split('\n');
    const findings = f.findings
      .filter((x) => {
        if (isIgnored(lines, x.line)) {
          ignored++;
          return false;
        }
        if (allowTestValues && typeof x.start === 'number'
            && KNOWN_TEST_VALUES.has(normalise(content.slice(x.start, x.end)))) {
          testValues++;
          return false;
        }
        return true;
      })
      .map((x) => ({ ...x, blocking: (RANK[x.severity] ?? 0) >= threshold }))
      .sort((a, b) => a.line - b.line || a.column - b.column);
    return { ...f, findings };
  });

  const all = files.flatMap((f) => f.findings);
  return {
    files,
    failOn,
    blocking: all.filter((x) => x.blocking).length,
    warnings: all.filter((x) => !x.blocking).length,
    ignored,
    testValues,
    passed: all.every((x) => !x.blocking),
  };
}

// ── Human output ─────────────────────────────────────────────────────────────

function palette(enabled) {
  const wrap = (code) => (s) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : String(s));
  return {
    red: wrap('31'), yellow: wrap('33'), green: wrap('32'), cyan: wrap('36'),
    dim: wrap('2'), bold: wrap('1'), underline: wrap('4'),
  };
}

function severityColor(c, severity) {
  return { CRITICAL: c.red, HIGH: c.red, MEDIUM: c.yellow, LOW: c.dim }[severity] ?? ((s) => s);
}

/**
 * @param {ReturnType<typeof evaluate>} verdict
 * @param {{ color?: boolean, skipped?: object[], summary?: object, staged?: boolean, scanned?: number }} opts
 */
function formatHuman(verdict, { color = false, skipped = [], summary = {}, staged = false, scanned = 0 } = {}) {
  const c = palette(color);
  const out = [];

  for (const f of verdict.files) {
    if (f.findings.length === 0) continue;
    out.push(c.underline(f.path) + (f.regexOnly ? c.dim('  (large file: regex rules only)') : ''));
    for (const x of f.findings) {
      const sev = severityColor(c, x.severity)(x.severity.padEnd(8));
      const where = c.dim(`${x.line}:${x.column}`.padEnd(8));
      const conf = typeof x.confidence === 'number' ? c.dim(` ${Math.round(x.confidence * 100)}%`) : '';
      const label = (x.patternName || x.category).padEnd(26);
      out.push(`  ${where} ${x.blocking ? sev : c.dim(x.severity.padEnd(8))} ${label} ${c.cyan(x.preview)}${conf}`);
    }
    out.push('');
  }

  const files = scanned === 1 ? '1 file' : `${scanned} files`;
  const notes = [];
  if (verdict.ignored) notes.push(`${verdict.ignored} ignored inline`);
  if (verdict.testValues) notes.push(`${verdict.testValues} documented test value${verdict.testValues === 1 ? '' : 's'}`);
  if (skipped.length) notes.push(`${skipped.length} skipped`);
  if (summary.filesFellBack) notes.push(`${summary.filesFellBack} scanned with regex only (AI service unavailable)`);
  const tail = notes.length ? c.dim(` (${notes.join(', ')})`) : '';

  if (verdict.passed) {
    const warn = verdict.warnings ? `, ${verdict.warnings} below ${verdict.failOn}` : '';
    out.push(`${c.green('✔')} PromptGuard: no findings at or above ${verdict.failOn} in ${files}${warn}${tail}`);
  } else {
    out.push(`${c.red('✖')} PromptGuard: ${c.bold(`${verdict.blocking} finding${verdict.blocking === 1 ? '' : 's'}`)} at or above ${verdict.failOn} in ${files}${tail}`);
    if (staged) {
      out.push(c.dim('  Commit blocked. Remove or mask the values, mark a false positive with a'));
      out.push(c.dim(`  "${IGNORE_LINE}" comment, or skip this check once with: git commit --no-verify`));
    }
  }
  return out.join('\n');
}

function formatJson(verdict, { skipped = [], summary = {} } = {}) {
  return JSON.stringify({
    passed  : verdict.passed,
    failOn  : verdict.failOn,
    blocking: verdict.blocking,
    warnings: verdict.warnings,
    ignored : verdict.ignored,
    testValues: verdict.testValues,
    files   : verdict.files.filter((f) => f.findings.length).map((f) => ({
      path: f.path,
      findings: f.findings.map(({ line, column, severity, category, patternName, source, confidence, preview, blocking }) =>
        ({ line, column, severity, category, patternName, source, confidence, preview, blocking })),
    })),
    skipped,
    summary,
  }, null, 2);
}

module.exports = { evaluate, formatHuman, formatJson, SEVERITIES, IGNORE_LINE, IGNORE_NEXT, KNOWN_TEST_VALUES };
