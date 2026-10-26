const { parseArgs } = require('util');
const { collectPaths, collectStaged } = require('./files');
const { scanFiles, ApiUnreachableError } = require('./api');
const { evaluate, formatHuman, formatJson, SEVERITIES } = require('./report');
const hook = require('./hook');
const { version } = require('../package.json');

/**
 * Exit codes
 *   0  no findings at or above --fail-on
 *   1  findings at or above --fail-on (commit blocked)
 *   2  usage error
 *   3  PromptGuard API unreachable or returned an error
 */
const EXIT = { OK: 0, FINDINGS: 1, USAGE: 2, API: 3 };

const MODES = ['REGEX', 'AI', 'HYBRID'];

const HELP = `promptguard ${version} — find secrets and PII before they leave your machine

Usage
  promptguard scan [paths…]          scan files or directories (default: .)
  promptguard scan --staged          scan what the next git commit contains
  promptguard hook install           block commits with findings (git pre-commit hook)
  promptguard hook uninstall         remove the hook

Options
  --staged               scan the git index instead of paths
  --fail-on <level>      LOW | MEDIUM | HIGH | CRITICAL (default HIGH)
  --mode <mode>          REGEX | AI | HYBRID (default: the server's detection_mode)
  --api <url>            PromptGuard API (default $PROMPTGUARD_API or http://localhost:4000)
  --exclude <glob>       skip matching paths; repeatable (also reads .promptguardignore)
  --offline <allow|block>  when the API is unreachable: allow (exit 0) or block (exit 3, default)
  --include-test-values  also report documented example values (AKIAIOSFODNN7EXAMPLE,
                         test card 4111 1111 1111 1111, …), which are skipped by default
  --json                 machine-readable output
  --no-color             plain output
  --force                (hook install) replace an existing pre-commit hook, keeping a backup
  -h, --help             show this help
  -v, --version          print the version

Mark a false positive with a "promptguard:ignore" comment on the line, or
"promptguard:ignore-next-line" on the line above.

Exit codes: 0 clean · 1 findings at or above --fail-on · 2 usage error · 3 API unavailable`;

const OPTIONS = {
  staged   : { type: 'boolean' },
  'fail-on': { type: 'string' },
  mode     : { type: 'string' },
  api      : { type: 'string' },
  exclude  : { type: 'string', multiple: true },
  offline  : { type: 'string' },
  json     : { type: 'boolean' },
  'include-test-values': { type: 'boolean' },
  'no-color': { type: 'boolean' },
  force    : { type: 'boolean' },
  timeout  : { type: 'string' },
  help     : { type: 'boolean', short: 'h' },
  version  : { type: 'boolean', short: 'v' },
};

class UsageError extends Error {}

function parse(argv) {
  try {
    return parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (err) {
    throw new UsageError(err.message);
  }
}

function option(values, name, allowed, fallback) {
  const raw = values[name];
  if (raw === undefined) return fallback;
  const v = raw.toUpperCase();
  if (!allowed.includes(v)) throw new UsageError(`--${name} must be one of: ${allowed.join(', ')}`);
  return v;
}

async function runScan(values, positionals, io) {
  const failOn = option(values, 'fail-on', SEVERITIES, 'HIGH');
  const mode = option(values, 'mode', MODES, undefined);
  const offline = option(values, 'offline', ['ALLOW', 'BLOCK'], 'BLOCK');
  const strict = io.env.PROMPTGUARD_STRICT === '1';
  const api = values.api ?? io.env.PROMPTGUARD_API ?? 'http://localhost:4000';
  const timeoutMs = values.timeout ? Number(values.timeout) * 1000 : undefined;
  const color = !values['no-color'] && !values.json && io.isTTY && !io.env.NO_COLOR;

  if (values.staged && positionals.length) throw new UsageError('use either --staged or paths, not both');

  const collected = values.staged
    ? collectStaged({ cwd: io.cwd, exclude: values.exclude })
    : collectPaths(positionals, { cwd: io.cwd, exclude: values.exclude });
  const { files, skipped } = collected;
  const nonEmpty = files.filter((f) => f.content.trim());

  if (nonEmpty.length === 0) {
    const verdict = evaluate([], [], failOn);
    io.out(values.json ? formatJson(verdict, { skipped }) : formatHuman(verdict, { color, skipped, scanned: 0, staged: values.staged }));
    return EXIT.OK;
  }

  let result;
  try {
    result = await scanFiles(api, nonEmpty, { mode, timeoutMs });
  } catch (err) {
    if (err instanceof ApiUnreachableError && offline === 'ALLOW' && !strict) {
      io.err(`⚠ ${err.message} — skipping the PromptGuard check. Set PROMPTGUARD_STRICT=1 to block instead.`);
      return EXIT.OK;
    }
    io.err(`✖ ${err.message}`);
    return EXIT.API;
  }

  const verdict = evaluate(result.files, nonEmpty, failOn, { allowTestValues: !values['include-test-values'] });
  const opts = { color, skipped, summary: result.summary, staged: values.staged, scanned: nonEmpty.length };
  io.out(values.json ? formatJson(verdict, opts) : formatHuman(verdict, opts));
  return verdict.passed ? EXIT.OK : EXIT.FINDINGS;
}

function runHook(values, positionals, io) {
  const action = positionals[0];
  if (action === 'install') {
    const failOn = option(values, 'fail-on', SEVERITIES, 'HIGH');
    const mode = option(values, 'mode', MODES, undefined);
    const { path, backedUp } = hook.install({ cwd: io.cwd, force: values.force, failOn, mode, api: values.api });
    io.out(`✔ Installed pre-commit hook: ${path}`);
    if (backedUp) io.out(`  Your previous hook was saved to ${backedUp}`);
    io.out(`  Commits with findings at or above ${failOn} will be blocked. Skip once with: git commit --no-verify`);
    return EXIT.OK;
  }
  if (action === 'uninstall') {
    const { removed, restored, path } = hook.uninstall({ cwd: io.cwd });
    if (!removed) io.out(`No PromptGuard hook at ${path}`);
    else io.out(`✔ Removed ${path}${restored ? ' (restored your previous hook)' : ''}`);
    return EXIT.OK;
  }
  throw new UsageError('usage: promptguard hook <install|uninstall>');
}

/**
 * @param {string[]} argv
 * @param {object} [io] — injectable for tests
 * @returns {Promise<number>} exit code
 */
async function main(argv, io = {}) {
  io = {
    cwd  : process.cwd(),
    env  : process.env,
    isTTY: Boolean(process.stdout.isTTY),
    out  : (s) => process.stdout.write(`${s}\n`),
    err  : (s) => process.stderr.write(`${s}\n`),
    ...io,
  };

  try {
    const { values, positionals } = parse(argv);
    if (values.version) {
      io.out(version);
      return EXIT.OK;
    }
    const [command, ...rest] = positionals;
    if (values.help || !command || command === 'help') {
      io.out(HELP);
      return command || values.help ? EXIT.OK : EXIT.USAGE;
    }
    if (command === 'scan') return await runScan(values, rest, io);
    if (command === 'hook') return runHook(values, rest, io);
    throw new UsageError(`unknown command "${command}" — run promptguard --help`);
  } catch (err) {
    if (err instanceof UsageError) {
      io.err(`promptguard: ${err.message}`);
      return EXIT.USAGE;
    }
    if (/not inside a git repository|already exists/.test(err.message)) {
      io.err(`promptguard: ${err.message}`);
      return EXIT.USAGE;
    }
    throw err;
  }
}

module.exports = { main, EXIT, HELP };
