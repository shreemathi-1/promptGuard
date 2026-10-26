const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { stub, real, dbStub, listen, post, get, mock, args } = require('./helpers');

// Benchmark report location is read when the eval router loads
const RESULTS = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pg-eval-')), 'latest.json');
process.env.EVAL_RESULTS_PATH = RESULTS;

dbStub();
const audit = stub('src/services/auditLogger', {
  writeAuditLog: mock.fn(async () => ({})),
  extractIp: mock.fn(() => '127.0.0.1'),
});
const pipeline = real('src/services/detectionPipeline');
pipeline.runDetection = mock.fn();
const mlClient = real('src/services/mlClient');
mlClient.pseudonymize = mock.fn();
mlClient.explain = mock.fn();
mlClient.generateRule = mock.fn();

const app = require('../src/app');

// Made-up key, written in two pieces so secret scanners don't flag the source
const KEY = 'AKIA' + 'Q7XR2MZP4KD8NW3T';

const RESULT = {
  detections: [{ patternId: null, patternName: 'Person Name', category: 'PERSON', severity: 'MEDIUM', match: 'Priya', start: 0, end: 5, length: 5, source: 'AI', confidence: 0.9 }],
  detectionCount: 1, mode: 'HYBRID', effectiveMode: 'HYBRID', aiAvailable: true,
  aiDetectionCount: 1, filteredCount: 0, filtered: [],
  injection: { score: 0.96, label: 'INJECTION', isInjection: true, model: 'm' },
};

/** A detection result for `text` that flags every occurrence of KEY */
function keyResult(text, mode = 'HYBRID') {
  const detections = [];
  let i = text.indexOf(KEY);
  while (i !== -1) {
    detections.push({ patternName: 'AWS Access Key', category: 'API_KEY', severity: 'CRITICAL', match: KEY, start: i, end: i + KEY.length, length: KEY.length, source: 'HYBRID', confidence: 0.95 });
    i = text.indexOf(KEY, i + 1);
  }
  return { ...RESULT, detections, detectionCount: detections.length, mode, effectiveMode: mode, aiDetectionCount: 0, injection: null };
}

let server;
before(async () => { server = await listen(app); });
after(() => server.close());
beforeEach(() => {
  for (const fn of [audit.writeAuditLog, pipeline.runDetection, mlClient.pseudonymize, mlClient.explain, mlClient.generateRule]) fn.mock.resetCalls();
  pipeline.runDetection.mock.mockImplementation(async () => RESULT);
});

// ── /api/scan, /api/mask ─────────────────────────────────────────────────────

test('POST /api/scan passes mode through and logs AI fields', async () => {
  const res = await post(server.url, '/api/scan', { text: 'Priya here', mode: 'AI' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.injection.isInjection, true);
  // Scan is the only route that hides findings below sensitivity_level
  assert.deepEqual(args(pipeline.runDetection), ['Priya here', { mode: 'AI', applySensitivity: true }]);
  const logged = args(audit.writeAuditLog)[0];
  assert.equal(logged.detectionMode, 'HYBRID');
  assert.equal(logged.injectionScore, 0.96);
  assert.equal(logged.aiDetectionCount, 1);
});

test('POST /api/scan rejects an unknown mode', async () => {
  const res = await post(server.url, '/api/scan', { text: 'hi', mode: 'MAGIC' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /"mode" must be one of/);
});

test('POST /api/mask masks AI detections and reports their source', async () => {
  const res = await post(server.url, '/api/mask', { text: 'Priya here', style: 'REDACT' });
  assert.equal(res.status, 200);
  assert.ok(!res.body.data.maskedText.includes('Priya'));
  assert.equal(res.body.data.aiAvailable, true);
  assert.equal(res.body.data.replacements[0].source, 'AI');
  assert.equal(res.body.data.replacements[0].confidence, 0.9);
});

test('POST /api/mask does not apply the sensitivity setting', async () => {
  await post(server.url, '/api/mask', { text: 'Priya here', style: 'REDACT' });
  assert.equal(args(pipeline.runDetection)[1].applySensitivity, undefined);
});

// ── /api/scan/batch ──────────────────────────────────────────────────────────

test('batch scan: line/column, masked preview, no injection check, long ML timeout', async () => {
  pipeline.runDetection.mock.mockImplementation(async (text) => keyResult(text));
  const content = `// config\nconst key = "${KEY}";\n`;
  const res = await post(server.url, '/api/scan/batch', { files: [{ path: 'src/a.js', content }, { path: 'b.txt', content: 'nothing' }] });

  assert.equal(res.status, 200);
  const [a, b] = res.body.data.files;
  assert.deepEqual([a.findings[0].line, a.findings[0].column], [2, 14]);
  assert.equal(a.findings[0].preview, 'AKIA************NW3T');
  assert.equal(b.findings.length, 0);
  assert.equal(res.body.data.summary.findings, 1);
  assert.equal(res.body.data.summary.highestSeverity, 'CRITICAL');
  assert.ok(!('_detections' in a), 'internal fields are not returned');

  const opts = args(pipeline.runDetection)[1];
  assert.equal(opts.injectionCheck, false);
  assert.deepEqual(opts.mlOptions, { timeoutMs: 60_000, breaker: false });
});

test('batch scan: the audit log never stores the secret itself', async () => {
  pipeline.runDetection.mock.mockImplementation(async (text) => keyResult(text));
  await post(server.url, '/api/scan/batch', { files: [{ path: 'a.env', content: `KEY=${KEY}` }, { path: 'clean.txt', content: 'hello' }] });
  assert.equal(audit.writeAuditLog.mock.callCount(), 1, 'only files with findings are audited');
  const logged = JSON.stringify(args(audit.writeAuditLog)[0]);
  assert.ok(!logged.includes(KEY), 'no raw key in the audit entry');
  assert.ok(logged.includes('AKIA************NW3T'));
});

test('batch scan: files over the ML limit are scanned with regex only', async () => {
  pipeline.runDetection.mock.mockImplementation(async (text, opts) => keyResult(text, opts.mode ?? 'HYBRID'));
  const big = `${'x\n'.repeat(30_000)}${KEY}`;
  const res = await post(server.url, '/api/scan/batch', { files: [{ path: 'big.txt', content: big }] });
  assert.equal(res.status, 200, 'large bodies are accepted on this route');
  assert.equal(args(pipeline.runDetection)[1].mode, 'REGEX');
  assert.equal(res.body.data.files[0].regexOnly, true);
  assert.equal(res.body.data.files[0].findings[0].line, 30_001);
});

test('batch scan: validation', async () => {
  assert.equal((await post(server.url, '/api/scan/batch', { files: [] })).status, 400);
  assert.equal((await post(server.url, '/api/scan/batch', { files: [{ path: '', content: 'x' }] })).status, 400);
  assert.equal((await post(server.url, '/api/scan/batch', { files: [{ path: 'a', content: 'x' }], mode: 'NOPE' })).status, 400);
});

test('other routes keep the small body limit', async () => {
  const res = await fetch(`${server.url}/api/scan`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'x'.repeat(200_000) }),
  });
  assert.equal(res.status, 413);
});

// ── /api/eval/results ────────────────────────────────────────────────────────

test('GET /api/eval/results: 404 with a hint, then the report', async () => {
  fs.rmSync(RESULTS, { force: true });
  const missing = await get(server.url, '/api/eval/results');
  assert.equal(missing.status, 404);
  assert.match(missing.body.error, /run_benchmark\.py/);

  fs.writeFileSync(RESULTS, JSON.stringify({ modes: { HYBRID: { lenient: { f1: 0.93 } } } }));
  const found = await get(server.url, '/api/eval/results');
  assert.equal(found.status, 200);
  assert.equal(found.body.data.modes.HYBRID.lenient.f1, 0.93);
});

// ── /api/ai ──────────────────────────────────────────────────────────────────

test('POST /api/ai/rewrite pseudonymizes the detections and audits it', async () => {
  mlClient.pseudonymize.mock.mockImplementation(async () => ({
    text: 'Ananya here', mappingId: 'm1', ttlSeconds: 3600,
    replacements: [{ category: 'PERSON', original: 'Priya', fake: 'Ananya', start: 0, end: 5, fakeStart: 0, fakeEnd: 6 }],
  }));
  const res = await post(server.url, '/api/ai/rewrite', { text: 'Priya here' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.rewrittenText, 'Ananya here');
  assert.deepEqual(args(mlClient.pseudonymize)[1], [{ category: 'PERSON', match: 'Priya', start: 0, end: 5 }]);
  assert.equal(args(audit.writeAuditLog)[0].maskStyle, 'PSEUDONYMIZE');
});

test('POST /api/ai/rewrite → 503 when the ML service is down', async () => {
  mlClient.pseudonymize.mock.mockImplementation(async () => { throw new mlClient.MlUnavailableError('down'); });
  const res = await post(server.url, '/api/ai/rewrite', { text: 'Priya here' });
  assert.equal(res.status, 503);
});

test('POST /api/ai/explain → 503 with a code when the local LLM is missing', async () => {
  mlClient.explain.mock.mockImplementation(async () => {
    const err = new mlClient.LlmUnavailableError('Ollama unreachable');
    err.code = 'LLM_UNAVAILABLE';
    throw err;
  });
  const res = await post(server.url, '/api/ai/explain', { category: 'AADHAAR', useLlm: true });
  assert.equal(res.status, 503);
  assert.equal(res.body.code, 'LLM_UNAVAILABLE');
});

// ── /api/rules/generate ──────────────────────────────────────────────────────

test('POST /api/rules/generate re-tests the pattern with the JavaScript engine', async () => {
  mlClient.generateRule.mock.mockImplementation(async () => ({
    rule: { pattern: '\\bEMP-\\d{6}\\b', name: 'Employee ID', category: 'CUSTOM', severity: 'HIGH', explanation: '', problems: [], warnings: [], strategy: 'EXAMPLES' },
    attempts: 1, model: 'm',
  }));
  const res = await post(server.url, '/api/rules/generate', {
    description: 'employee ids', examples: ['EMP-123456', 'emp-000001'], negatives: ['TEMP-123456'],
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.verified, true);
  assert.deepEqual(res.body.data.tests.map((t) => t.passed), [true, true, true]);
});

test('POST /api/rules/generate flags a pattern that breaks in JavaScript', async () => {
  mlClient.generateRule.mock.mockImplementation(async () => ({
    rule: { pattern: '(?P<id>\\d+)', name: 'x', category: 'CUSTOM', severity: 'LOW', explanation: '', problems: [], warnings: [], strategy: 'LLM' },
    attempts: 3, model: 'm',
  }));
  const res = await post(server.url, '/api/rules/generate', { description: 'ids', examples: ['123'] });
  assert.equal(res.body.data.verified, false);
  assert.match(res.body.data.rule.problems.join(' '), /Invalid regex in JavaScript/);
});

test('malformed JSON is a 400, not a 500', async () => {
  const res = await fetch(`${server.url}/api/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"text": ' });
  assert.equal(res.status, 400);
});
