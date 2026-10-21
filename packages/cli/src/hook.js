const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * Installs a git pre-commit hook that runs `promptguard scan --staged`.
 *
 * The hook runs for every commit — terminal, VS Code's Source Control panel,
 * or any other git client — and is skipped only with `git commit --no-verify`.
 * If the PromptGuard API is down, the hook warns and lets the commit through
 * (set PROMPTGUARD_STRICT=1 to block instead).
 */

const MARKER = '# promptguard-hook';
const BACKUP_SUFFIX = '.promptguard-backup';

function hooksDir(cwd) {
  try {
    // Respects core.hooksPath and worktrees
    const dir = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
      .toString().trim();
    return path.resolve(cwd, dir);
  } catch {
    throw new Error('not inside a git repository');
  }
}

function shellQuote(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function hookScript({ failOn, mode, api }) {
  const node = process.execPath;
  const cli = path.resolve(__dirname, '..', 'bin', 'promptguard.js');
  const args = ['scan', '--staged', '--fail-on', failOn, '--offline', 'allow'];
  if (mode) args.push('--mode', mode);
  if (api) args.push('--api', api);
  return [
    '#!/bin/sh',
    `${MARKER} — installed by \`promptguard hook install\`; remove with \`promptguard hook uninstall\``,
    `# Blocks commits whose staged files contain secrets or PII at or above ${failOn}.`,
    '# Skip once with: git commit --no-verify',
    '',
    `exec ${shellQuote(node)} ${shellQuote(cli)} ${args.map(shellQuote).join(' ')}`,
    '',
  ].join('\n');
}

/**
 * @returns {{ path: string, backedUp: string | null }}
 */
function install({ cwd = process.cwd(), force = false, failOn = 'HIGH', mode, api } = {}) {
  const dir = hooksDir(cwd);
  const file = path.join(dir, 'pre-commit');
  let backedUp = null;

  if (fs.existsSync(file)) {
    const current = fs.readFileSync(file, 'utf8');
    if (!current.includes(MARKER)) {
      if (!force) {
        throw new Error(`${file} already exists and was not installed by PromptGuard. Re-run with --force to replace it (it will be backed up).`);
      }
      backedUp = file + BACKUP_SUFFIX;
      fs.copyFileSync(file, backedUp);
    }
  }

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, hookScript({ failOn, mode, api }), { mode: 0o755 });
  fs.chmodSync(file, 0o755);
  return { path: file, backedUp };
}

/**
 * @returns {{ removed: boolean, restored: boolean, path: string }}
 */
function uninstall({ cwd = process.cwd() } = {}) {
  const file = path.join(hooksDir(cwd), 'pre-commit');
  if (!fs.existsSync(file) || !fs.readFileSync(file, 'utf8').includes(MARKER)) {
    return { removed: false, restored: false, path: file };
  }
  fs.unlinkSync(file);
  const backup = file + BACKUP_SUFFIX;
  if (fs.existsSync(backup)) {
    fs.renameSync(backup, file);
    return { removed: true, restored: true, path: file };
  }
  return { removed: true, restored: false, path: file };
}

module.exports = { install, uninstall, hookScript, MARKER };
