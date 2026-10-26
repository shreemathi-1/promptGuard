const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createMatcher } = require('./ignore');

/**
 * Collects the files to scan, either from paths on disk or from the git index
 * (--staged: exactly what the next commit will contain, not the working tree).
 *
 * Result: { root, files: [{ path, content }], skipped: [{ path, reason }] }
 * Paths are relative to root, "/"-separated.
 */

const MAX_FILE_BYTES = 1_000_000;
const BINARY_SNIFF_BYTES = 8000;

function toPosix(p) {
  return p.split(path.sep).join('/');
}

/** Same heuristic as git: a NUL byte near the start means binary. */
function isBinary(buffer) {
  return buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

function git(args, cwd, opts = {}) {
  return execFileSync('git', args, { cwd, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

function repoRoot(cwd) {
  try {
    return git(['rev-parse', '--show-toplevel'], cwd).toString().trim();
  } catch {
    throw new Error('not inside a git repository');
  }
}

function accept(relPath, buffer, files, skipped) {
  if (buffer.length > MAX_FILE_BYTES) {
    skipped.push({ path: relPath, reason: `larger than ${MAX_FILE_BYTES / 1_000_000} MB` });
  } else if (isBinary(buffer)) {
    skipped.push({ path: relPath, reason: 'binary' });
  } else {
    files.push({ path: relPath, content: buffer.toString('utf8') });
  }
}

/**
 * Files staged for commit (added, copied, modified, renamed — not deleted),
 * read from the index.
 */
function collectStaged({ cwd = process.cwd(), exclude = [] } = {}) {
  const root = repoRoot(cwd);
  const isExcluded = createMatcher({ root, extra: exclude });
  const names = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], root)
    .toString()
    .split('\0')
    .filter(Boolean);

  const files = [];
  const skipped = [];
  for (const name of names) {
    if (isExcluded(name)) {
      skipped.push({ path: name, reason: 'excluded' });
      continue;
    }
    // ":path" = the staged (index) version
    accept(name, git(['show', `:${name}`], root), files, skipped);
  }
  return { root, files, skipped };
}

/** Files under the given paths (directories are walked recursively). */
function collectPaths(paths, { cwd = process.cwd(), exclude = [] } = {}) {
  const root = cwd;
  const isExcluded = createMatcher({ root, extra: exclude });
  const files = [];
  const skipped = [];
  const seen = new Set();

  function visit(abs) {
    // Outside the current directory, show the absolute path rather than ../../..
    const relative = path.relative(root, abs);
    const rel = relative.startsWith('..') ? toPosix(abs) : (toPosix(relative) || path.basename(abs));
    if (seen.has(abs)) return;
    seen.add(abs);

    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      skipped.push({ path: rel, reason: 'not found' });
      return;
    }
    if (stat.isDirectory()) {
      if (rel !== '.' && rel !== '' && isExcluded(`${rel}/`)) return;
      for (const entry of fs.readdirSync(abs).sort()) visit(path.join(abs, entry));
      return;
    }
    if (!stat.isFile()) return;
    if (isExcluded(rel)) {
      skipped.push({ path: rel, reason: 'excluded' });
      return;
    }
    accept(rel, fs.readFileSync(abs), files, skipped);
  }

  for (const p of paths.length ? paths : ['.']) visit(path.resolve(cwd, p));
  return { root, files, skipped };
}

module.exports = { collectStaged, collectPaths, isBinary, repoRoot, MAX_FILE_BYTES };
