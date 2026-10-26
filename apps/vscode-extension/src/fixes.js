/**
 * Pure helpers for the quick fixes (no vscode import, so they're unit-tested
 * directly): masking a value, moving it to .env, and ignoring a line.
 */

const HASH_COMMENT = new Set([
  'python', 'shellscript', 'yaml', 'ruby', 'perl', 'r', 'dockerfile', 'makefile', 'toml',
  'properties', 'dotenv', 'ini', 'powershell', 'elixir', 'coffeescript', 'julia', 'nim',
]);
const DASH_COMMENT = new Set(['sql', 'lua', 'haskell', 'ada']);
const HTML_COMMENT = new Set(['html', 'xml', 'markdown', 'vue-html', 'svg']);

/** Line-comment syntax for a VS Code language id → { open, close } */
function commentFor(languageId) {
  if (HASH_COMMENT.has(languageId)) return { open: '# ', close: '' };
  if (DASH_COMMENT.has(languageId)) return { open: '-- ', close: '' };
  if (HTML_COMMENT.has(languageId)) return { open: '<!-- ', close: ' -->' };
  if (languageId === 'css' || languageId === 'scss' || languageId === 'less') return { open: '/* ', close: ' */' };
  if (languageId === 'json' || languageId === 'plaintext') return null; // no comments
  return { open: '// ', close: '' };
}

/** The line with an ignore marker appended, or null if the language has no comments. */
function withIgnoreComment(lineText, languageId) {
  const c = commentFor(languageId);
  if (!c) return null;
  return `${lineText.replace(/\s+$/, '')}  ${c.open}promptguard:ignore${c.close}`;
}

const ENV_NAME_HINTS = [
  [/aws access key/i, 'AWS_ACCESS_KEY_ID'],
  [/aws secret/i, 'AWS_SECRET_ACCESS_KEY'],
  [/github/i, 'GITHUB_TOKEN'],
  [/stripe/i, 'STRIPE_SECRET_KEY'],
  [/slack/i, 'SLACK_TOKEN'],
];

/**
 * A sensible env var name: the variable the value was assigned to
 * (`const dbPassword = "…"` → DB_PASSWORD), a known key type, or the category.
 */
function envVarName(finding, lineText = '') {
  const label = finding.patternName || finding.category || 'SECRET';
  for (const [re, name] of ENV_NAME_HINTS) if (re.test(label)) return name;

  const before = lineText.slice(0, Math.max(0, (finding.column ?? 1) - 1));
  const assigned = before.match(/([A-Za-z_][A-Za-z0-9_]*)["']?\s*(?:[:=]|=>)\s*["'`]?$/);
  if (assigned) {
    return assigned[1].replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
  }
  return label.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toUpperCase() || 'SECRET';
}

function isValidEnvName(name) {
  return /^[A-Z_][A-Z0-9_]*$/.test(name);
}

/** How each language reads an environment variable; null = fix not offered. */
function envAccessor(languageId, name) {
  switch (languageId) {
    case 'javascript': case 'typescript': case 'javascriptreact': case 'typescriptreact':
      return `process.env.${name}`;
    case 'python':
      return `os.environ["${name}"]`;
    case 'go':
      return `os.Getenv("${name}")`;
    case 'java': case 'kotlin':
      return `System.getenv("${name}")`;
    case 'ruby':
      return `ENV["${name}"]`;
    case 'csharp':
      return `Environment.GetEnvironmentVariable("${name}")`;
    case 'php':
      return `getenv('${name}')`;
    case 'rust':
      return `std::env::var("${name}").unwrap()`;
    case 'shellscript':
      return `"$${name}"`;
    default:
      return null;
  }
}

/**
 * Widens [start, end) to include the quotes around a string literal, so
 * `key = "AKIA…"` becomes `key = process.env.AWS_ACCESS_KEY_ID`, not `"process.env…"`.
 * Works on columns within one line.
 */
function quotedRange(lineText, startCol, endCol) {
  const before = lineText[startCol - 1];
  const after = lineText[endCol];
  if (before && before === after && `"'\``.includes(before)) {
    return { start: startCol - 1, end: endCol + 1, quoted: true };
  }
  return { start: startCol, end: endCol, quoted: false };
}

/** Local masking for the quick fix (Mask Selection uses the backend instead). */
function maskValue(value, category, style) {
  if (style === 'PARTIAL') {
    const keep = value.length > 8 ? 4 : 0;
    return value.slice(0, value.length - keep).replace(/[A-Za-z0-9]/g, '*') + value.slice(value.length - keep);
  }
  return `[${category} REDACTED]`;
}

/** .env line for name=value, quoting when needed. */
function envLine(name, value) {
  return /[\s#"'$]/.test(value) ? `${name}="${value.replace(/["\\$]/g, '\\$&')}"` : `${name}=${value}`;
}

/** Whether a .gitignore already covers .env */
function gitignoreCoversEnv(gitignore) {
  return gitignore.split(/\r?\n/).some((l) => /^\/?\.env(\s|$)/.test(l.trim()) || l.trim() === '.env*' || l.trim() === '*.env');
}

/** "AKIAIOSFODNN7EXAMPLE" → "AKIA************MPLE" (same rule as the backend) */
function maskPreview(value) {
  const v = value.replace(/\s+/g, ' ');
  if (v.length >= 12) return v.slice(0, 4) + '*'.repeat(v.length - 8) + v.slice(-4);
  if (v.length >= 6) return v.slice(0, 2) + '*'.repeat(v.length - 2);
  return '*'.repeat(v.length);
}

module.exports = {
  commentFor, withIgnoreComment, envVarName, isValidEnvName, envAccessor,
  quotedRange, maskValue, envLine, gitignoreCoversEnv, maskPreview,
};
