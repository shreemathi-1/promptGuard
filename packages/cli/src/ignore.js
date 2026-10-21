const fs = require('fs');
const path = require('path');

/**
 * Which files to skip. Patterns are gitignore-style globs:
 *   *      anything except "/"        **   any number of directories
 *   ?      one character              {a,b} either alternative
 * A pattern without "/" matches the file or directory name at any depth.
 */

const DEFAULT_EXCLUDES = [
  // dependencies, build output, VCS
  'node_modules/', '.git/', '.venv/', 'venv/', '__pycache__/', 'dist/', 'build/', 'coverage/',
  // lockfiles: full of integrity hashes that look like keys
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock', 'Pipfile.lock', 'Cargo.lock', 'go.sum',
  // generated / minified
  '*.min.js', '*.min.css', '*.map',
  // binary-ish assets (binary files are also detected by content)
  '*.{png,jpg,jpeg,gif,ico,webp,svg,pdf,zip,gz,tgz,woff,woff2,ttf,eot,mp4,mp3,wasm}',
];

const IGNORE_FILE = '.promptguardignore';

function escapeRegex(s) {
  return s.replace(/[.+^$()|[\]\\]/g, '\\$&');
}

/** Expands the first {a,b} group, recursively: "*.{js,ts}" → ["*.js", "*.ts"]. */
function expandBraces(pattern) {
  const m = pattern.match(/\{([^{}]*)\}/);
  if (!m) return [pattern];
  return m[1].split(',').flatMap((alt) =>
    expandBraces(pattern.slice(0, m.index) + alt + pattern.slice(m.index + m[0].length)));
}

/**
 * @param {string} glob
 * @returns {RegExp} matches a "/"-separated path relative to the scan root
 */
function globToRegExp(glob) {
  let g = glob.trim().replace(/\\/g, '/');
  const dirOnly = g.endsWith('/');
  if (dirOnly) g = g.slice(0, -1);
  const anchored = g.startsWith('/') || g.slice(0, -1).includes('/');
  if (g.startsWith('/')) g = g.slice(1);

  let re = '';
  for (let i = 0; i < g.length; i++) {
    const ch = g[i];
    if (ch === '*') {
      if (g[i + 1] === '*') {
        // "**/" = any directories (including none); "**" at the end = anything
        if (g[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else {
      re += escapeRegex(ch);
    }
  }

  const prefix = anchored ? '^' : '^(?:.*/)?';
  // A directory pattern also matches everything inside it
  const suffix = dirOnly ? '/.*$' : '(?:/.*)?$';
  return new RegExp(prefix + re + suffix);
}

function compile(patterns) {
  return patterns
    .flatMap(expandBraces)
    .filter((p) => p.trim() && !p.trim().startsWith('#'))
    .map(globToRegExp);
}

/** Lines of .promptguardignore in dir, or [] when it doesn't exist. */
function readIgnoreFile(dir) {
  try {
    return fs.readFileSync(path.join(dir, IGNORE_FILE), 'utf8').split(/\r?\n/);
  } catch {
    return [];
  }
}

/**
 * @param {{ root: string, extra?: string[], useDefaults?: boolean }} opts
 * @returns {(relPath: string) => boolean} true when the path should be skipped
 */
function createMatcher({ root, extra = [], useDefaults = true }) {
  const regexes = compile([...(useDefaults ? DEFAULT_EXCLUDES : []), ...readIgnoreFile(root), ...extra]);
  return (relPath) => {
    const p = relPath.split(path.sep).join('/');
    return regexes.some((re) => re.test(p));
  };
}

module.exports = { globToRegExp, expandBraces, createMatcher, DEFAULT_EXCLUDES, IGNORE_FILE };
