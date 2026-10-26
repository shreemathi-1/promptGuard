const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const { main, EXIT } = require('../src/cli');
const { globToRegExp, createMatcher } = require('../src/ignore');
const { evaluate } = require('../src/report');
const { chunk, MAX_FILES_PER_BATCH } = require('../src/api');
const { isBinary } = require('../src/files');
const { startFakeApi, tmpDir, gitRepo, run } = require('./helpers');

// Async on purpose: the hook calls the fake API served by this same process,
// so a synchronous spawn would deadlock the event loop
function commit(dir, ...args) {
  return new Promise((resolve) => {
    const child = spawn('git', ['commit', ...args], { cwd: dir });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    child.on('close', (status) => resolve({ status, output }));
  });
}

// Not AWS's documented example key, which is allowlisted
// Made-up key, written in two pieces so secret scanners don't flag the source
const KEY = 'AKIA' + 'Q7XR2MZP4KD8NW3T';

// ── Units ────────────────────────────────────────────────────────────────────

describe('ignore globs', () => {
  const cases = [
    ['node_modules/', 'node_modules/a/b.js', true],
    ['node_modules/', 'pkg/node_modules/a.js', true],
    ['node_modules/', 'node_modules_old.js', false],
    ['*.min.js', 'public/app.min.js', true],
    ['/secrets.txt', 'secrets.txt', true],
    ['/secrets.txt', 'a/secrets.txt', false],
    ['docs/**/*.md', 'docs/a/b.md', true],
    ['docs/**/*.md', 'docs/b.md', true],
    ['fixtures', 'test/fixtures/key.txt', true],
  ];
  for (const [glob, file, expected] of cases) {
    test(`${glob} ${expected ? 'matches' : 'does not match'} ${file}`, () => {
      assert.equal(globToRegExp(glob).test(file), expected);
    });
  }

  test('defaults skip lockfiles and images, and read .promptguardignore', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, '.promptguardignore'), '# comment\nfixtures/\n');
    const skip = createMatcher({ root: dir });
    assert.ok(skip('package-lock.json'));
    assert.ok(skip('assets/logo.png'));
    assert.ok(skip('fixtures/fake-key.txt'));
    assert.ok(!skip('src/config.js'));
  });
});

describe('report', () => {
  const source = [
    `const a = "${KEY}";`,
    `const b = "${KEY}"; // promptguard:ignore`,
    '// promptguard:ignore-next-line',
    `const c = "${KEY}";`,
    'contact: a@b.co',
  ].join('\n');
  const result = [{
    path: 'x.js',
    findings: [1, 2, 4].map((line) => ({ line, column: 12, severity: 'CRITICAL', category: 'API_KEY', preview: 'AKIA****' }))
      .concat([{ line: 5, column: 10, severity: 'LOW', category: 'EMAIL', preview: 'a@****' }]),
  }];

  test('inline comments suppress findings', () => {
    const v = evaluate(result, [{ path: 'x.js', content: source }], 'HIGH');
    assert.equal(v.ignored, 2);
    assert.equal(v.blocking, 1);
    assert.equal(v.warnings, 1);
    assert.equal(v.passed, false);
  });

  test('threshold decides what blocks', () => {
    assert.equal(evaluate(result, [{ path: 'x.js', content: source }], 'LOW').blocking, 2);
    const clean = evaluate([{ path: 'y.js', findings: result[0].findings.slice(3) }], [{ path: 'y.js', content: source }], 'HIGH');
    assert.equal(clean.passed, true);
  });
});

test('batches respect file-count and size limits', () => {
  const files = Array.from({ length: MAX_FILES_PER_BATCH + 5 }, (_, i) => ({ path: `f${i}`, content: 'x' }));
  assert.deepEqual(chunk(files).map((b) => b.length), [MAX_FILES_PER_BATCH, 5]);
  const big = [{ path: 'a', content: 'x'.repeat(3_000_000) }, { path: 'b', content: 'x'.repeat(3_000_000) }];
  assert.equal(chunk(big).length, 2);
});

test('binary detection', () => {
  assert.ok(isBinary(Buffer.from([0x89, 0x50, 0x00, 0x47])));
  assert.ok(!isBinary(Buffer.from('plain text')));
});

// ── CLI against a fake API ───────────────────────────────────────────────────

describe('scan', () => {
  let api;
  before(async () => { api = await startFakeApi(); });
  after(() => api.close());

  test('finds a key in a directory and exits 1', async () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'config.js'), `\nexport const key = "${KEY}";\n`);
    fs.writeFileSync(path.join(dir, 'src', 'ok.js'), 'export const n = 1;\n');
    fs.mkdirSync(path.join(dir, 'node_modules'));
    fs.writeFileSync(path.join(dir, 'node_modules', 'dep.js'), `"${KEY}"`);

    const r = await run(main, ['scan', '--api', api.url], { cwd: dir });
    assert.equal(r.code, EXIT.FINDINGS);
    assert.match(r.out, /src\/config\.js/);
    assert.match(r.out, /2:21\s+CRITICAL/);
    assert.doesNotMatch(r.out, /node_modules/);
    // the secret itself is never printed
    assert.doesNotMatch(r.out, new RegExp(KEY));
  });

  test('--fail-on CRITICAL passes when only LOW findings exist', async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'a.md'), 'mail me: dev@example.com\n');
    const r = await run(main, ['scan', '--api', api.url, '--fail-on', 'critical'], { cwd: dir });
    assert.equal(r.code, EXIT.OK);
    assert.match(r.out, /1 below CRITICAL/);
  });

  test('--json is machine-readable', async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'k.txt'), KEY);
    const r = await run(main, ['scan', '--api', api.url, '--json'], { cwd: dir });
    const body = JSON.parse(r.out);
    assert.equal(body.passed, false);
    assert.equal(body.files[0].findings[0].category, 'API_KEY');
    assert.equal(body.files[0].findings[0].blocking, true);
  });

  test('API unreachable: exit 3, or 0 with --offline allow, unless PROMPTGUARD_STRICT=1', async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'k.txt'), KEY);
    const dead = 'http://127.0.0.1:9';
    assert.equal((await run(main, ['scan', '--api', dead], { cwd: dir })).code, EXIT.API);
    assert.equal((await run(main, ['scan', '--api', dead, '--offline', 'allow'], { cwd: dir })).code, EXIT.OK);
    const strict = await run(main, ['scan', '--api', dead, '--offline', 'allow'], { cwd: dir, env: { PROMPTGUARD_STRICT: '1' } });
    assert.equal(strict.code, EXIT.API);
  });

  test('--staged scans the index, not the working tree', async () => {
    const { dir, git } = gitRepo();
    fs.writeFileSync(path.join(dir, 'a.txt'), `key=${KEY}\n`);
    git('add', 'a.txt');
    // The working copy no longer has the key, but the staged version does
    fs.writeFileSync(path.join(dir, 'a.txt'), 'key=redacted\n');
    const r = await run(main, ['scan', '--staged', '--api', api.url], { cwd: dir });
    assert.equal(r.code, EXIT.FINDINGS);
    assert.match(r.out, /Commit blocked/);
  });

  test('usage errors exit 2', async () => {
    assert.equal((await run(main, ['scan', '--mode', 'magic'])).code, EXIT.USAGE);
    assert.equal((await run(main, ['scan', '--staged', 'a.txt'])).code, EXIT.USAGE);
    assert.equal((await run(main, ['nope'])).code, EXIT.USAGE);
  });
});

// ── Real git commit through the installed hook ───────────────────────────────

describe('pre-commit hook', () => {
  let api;
  before(async () => { api = await startFakeApi(); });
  after(() => api.close());

  test('blocks a commit with a key and allows a clean one', async () => {
    const { dir, git } = gitRepo();
    const installed = await run(main, ['hook', 'install', '--api', api.url], { cwd: dir });
    assert.equal(installed.code, EXIT.OK);

    fs.writeFileSync(path.join(dir, 'secret.env'), `AWS_ACCESS_KEY_ID=${KEY}\n`);
    git('add', 'secret.env');
    const blocked = await commit(dir, '-m', 'add key');
    assert.notEqual(blocked.status, 0, 'commit with a key must fail');
    assert.match(blocked.output, /PromptGuard: 1 finding at or above HIGH/);
    assert.throws(() => git('rev-parse', 'HEAD'), 'no commit was created');

    // --no-verify is the documented escape hatch
    assert.equal((await commit(dir, '-m', 'forced', '--no-verify')).status, 0);

    fs.writeFileSync(path.join(dir, 'readme.md'), 'hello\n');
    git('add', 'readme.md');
    assert.equal((await commit(dir, '-m', 'clean')).status, 0);
  });

  test('refuses to overwrite a foreign hook without --force, and restores it on uninstall', async () => {
    const { dir } = gitRepo();
    const hookFile = path.join(dir, '.git', 'hooks', 'pre-commit');
    fs.writeFileSync(hookFile, '#!/bin/sh\necho mine\n', { mode: 0o755 });

    const refused = await run(main, ['hook', 'install'], { cwd: dir });
    assert.equal(refused.code, EXIT.USAGE);
    assert.match(refused.err, /--force/);

    assert.equal((await run(main, ['hook', 'install', '--force'], { cwd: dir })).code, EXIT.OK);
    assert.match(fs.readFileSync(hookFile, 'utf8'), /promptguard-hook/);

    await run(main, ['hook', 'uninstall'], { cwd: dir });
    assert.equal(fs.readFileSync(hookFile, 'utf8'), '#!/bin/sh\necho mine\n');
  });

  test('hook lets the commit through when the API is down (warns)', async () => {
    const { dir, git } = gitRepo();
    await run(main, ['hook', 'install', '--api', 'http://127.0.0.1:9'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\n');
    git('add', 'a.txt');
    const res = await commit(dir, '-m', 'offline');
    assert.equal(res.status, 0);
    assert.match(res.output, /skipping the PromptGuard check/);
  });
});

test('bin entry point runs', () => {
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'bin', 'promptguard.js'), '--version']).toString();
  assert.match(out, /^\d+\.\d+\.\d+/);
});

test('documented test values are skipped unless --include-test-values', () => {
  const content = 'key = "AKIAIOSFODNN7EXAMPLE"\ncard = "4111-1111-1111-1111"\nreal = "' + KEY + '"\n';
  const at = (v) => ({ start: content.indexOf(v), end: content.indexOf(v) + v.length });
  const findings = ['AKIAIOSFODNN7EXAMPLE', '4111-1111-1111-1111', KEY]
    .map((v, i) => ({ line: i + 1, column: 1, severity: 'CRITICAL', category: 'API_KEY', preview: 'x', ...at(v) }));
  const files = [{ path: 'a', findings }];
  const sources = [{ path: 'a', content }];

  const v = evaluate(files, sources, 'HIGH');
  assert.equal(v.testValues, 2);
  assert.equal(v.blocking, 1);
  assert.equal(evaluate(files, sources, 'HIGH', { allowTestValues: false }).blocking, 3);
});
