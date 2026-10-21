const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { stub, real, resolves, mock, args } = require('./helpers');

const db = stub('src/config/db', { query: mock.fn() });
const mlClient = stub('src/services/mlClient', {
  validate: mock.fn(), detect: mock.fn(), injection: mock.fn(),
  isEnabled: mock.fn(() => true), isCircuitOpen: mock.fn(() => false),
});
// Real dedupe / sort, stubbed regex matching
const scanner = real('src/services/scanner');
scanner.findMatches = mock.fn();
const { runDetection } = require('../src/services/detectionPipeline');

const TEXT = 'Priya Sharma, order 1234 5678 9012';

// Same span matched by two rules
const AADHAAR = { patternId: 'p1', patternName: 'Aadhaar Number', category: 'AADHAAR', severity: 'HIGH', match: '1234 5678 9012', start: 20, end: 34, length: 14 };
const BANK = { patternId: 'p2', patternName: 'US Bank Account Number', category: 'BANK_ACCOUNT', severity: 'HIGH', match: '1234', start: 20, end: 24, length: 4 };
const PERSON = { entityType: 'PERSON', category: 'PERSON', severity: 'MEDIUM', match: 'Priya Sharma', start: 0, end: 12, confidence: 0.98, recognizer: 'TransformersRecognizer' };

function settingsRows(rows) {
  db.query.mock.mockImplementation(async () => ({ rows: Object.entries(rows).map(([key, value]) => ({ key, value })) }));
}

function reset(fn, impl) {
  fn.mock.resetCalls();
  fn.mock.mockImplementation(impl);
}

beforeEach(() => {
  settingsRows({ detection_mode: 'HYBRID', ai_confidence_threshold: '0.6', injection_check: 'true' });
  reset(scanner.findMatches, async () => ({ matches: [AADHAAR, BANK], patternCount: 2 }));
  reset(mlClient.injection, async () => ({ score: 0.02, label: 'SAFE', isInjection: false, model: 'm' }));
  reset(mlClient.detect, async () => ({ entities: [PERSON] }));
  reset(mlClient.validate, async () => ({ results: [] }));
});

test('HYBRID drops low-confidence regex hits and adds AI entities', async () => {
  mlClient.validate.mock.mockImplementation(async () => ({
    results: [
      { index: 0, confidence: 0.1, checksum: false, reasons: ['verhoeff_invalid'] },
      { index: 1, confidence: 0.65, checksum: null, reasons: ['context:account'] },
    ],
  }));

  const result = await runDetection(TEXT);

  assert.equal(result.effectiveMode, 'HYBRID');
  assert.equal(result.aiAvailable, true);
  assert.equal(result.filteredCount, 1);
  assert.equal(result.filtered[0].category, 'AADHAAR');
  assert.deepEqual(result.detections.map((d) => [d.category, d.source]), [['BANK_ACCOUNT', 'HYBRID'], ['PERSON', 'AI']]);
  assert.equal(result.aiDetectionCount, 1);
  assert.deepEqual(args(mlClient.detect), [TEXT, { entities: 'ai', threshold: 0.6 }, undefined]);
});

test('falls back to regex when the ML service is down', async () => {
  const down = async () => { throw new Error('ML service unreachable'); };
  mlClient.validate.mock.mockImplementation(down);
  mlClient.detect.mock.mockImplementation(down);
  mlClient.injection.mock.mockImplementation(down);

  const result = await runDetection(TEXT);

  assert.equal(result.mode, 'HYBRID');
  assert.equal(result.effectiveMode, 'REGEX');
  assert.equal(result.aiAvailable, false);
  assert.equal(result.injection, null);
  // Overlapping hits: the longer Aadhaar span wins
  assert.equal(result.detections.length, 1);
  assert.equal(result.detections[0].category, 'AADHAAR');
  assert.equal(result.detections[0].source, 'REGEX');
  assert.equal(result.detections[0].confidence, null);
});

test('REGEX mode never calls the detector or validator', async () => {
  const result = await runDetection(TEXT, { mode: 'REGEX' });

  assert.equal(mlClient.validate.mock.callCount(), 0);
  assert.equal(mlClient.detect.mock.callCount(), 0);
  assert.ok(result.detections.every((d) => d.source === 'REGEX'));
  assert.equal(result.injection.label, 'SAFE');
});

test('AI mode asks for all entity types and ignores regex hits', async () => {
  const result = await runDetection(TEXT, { mode: 'AI' });

  assert.deepEqual(args(mlClient.detect), [TEXT, { entities: 'all', threshold: 0.6 }, undefined]);
  assert.equal(mlClient.validate.mock.callCount(), 0);
  assert.equal(result.detections.length, 1);
  assert.equal(result.detections[0].category, 'PERSON');
  assert.equal(result.detections[0].source, 'AI');
  assert.equal(result.detections[0].patternId, null);
});

test('reports injection and respects injection_check', async () => {
  mlClient.injection.mock.mockImplementation(async () => ({ score: 0.97, label: 'INJECTION', isInjection: true, model: 'm' }));
  const first = await runDetection(TEXT);
  assert.equal(first.injection.isInjection, true);
  assert.equal(first.injection.score, 0.97);

  settingsRows({ injection_check: 'false', detection_mode: 'REGEX' });
  mlClient.injection.mock.resetCalls();
  const result = await runDetection(TEXT);
  assert.equal(mlClient.injection.mock.callCount(), 0);
  assert.equal(result.injection, null);
});

test('per-request overrides beat settings, and mlOptions reach every ML call', async () => {
  const opts = { timeoutMs: 60_000, breaker: false };
  await runDetection(TEXT, { mode: 'HYBRID', injectionCheck: true, mlOptions: opts });
  assert.equal(args(mlClient.detect)[2], opts);
  assert.equal(args(mlClient.validate)[2], opts);
  assert.equal(args(mlClient.injection)[1], opts);

  mlClient.injection.mock.resetCalls();
  await runDetection(TEXT, { injectionCheck: false });
  assert.equal(mlClient.injection.mock.callCount(), 0);
});

test('uses defaults when settings cannot be read', async () => {
  db.query.mock.mockImplementation(async () => { throw new Error('db down'); });
  const result = await runDetection(TEXT);
  assert.equal(result.mode, 'HYBRID');
  assert.equal(result.threshold, 0.6);
});

// ── sensitivity_level (Scan hides findings below it; everything else does not) ──

function hybridWithPerson() {
  mlClient.validate.mock.mockImplementation(async () => ({
    results: [
      { index: 0, confidence: 0.95, checksum: true, reasons: ['verhoeff_valid'] },
      { index: 1, confidence: 0.1, checksum: false, reasons: [] },
    ],
  }));
}

test('sensitivity_level is ignored unless the caller opts in', async () => {
  settingsRows({ detection_mode: 'HYBRID', ai_confidence_threshold: '0.6', injection_check: 'true', sensitivity_level: 'CRITICAL' });
  hybridWithPerson();

  const result = await runDetection(TEXT);

  assert.deepEqual(result.detections.map((d) => d.category), ['AADHAAR', 'PERSON']);
  assert.equal(result.hiddenBySeverity, 0);
  assert.equal(result.minSeverity, 'LOW');
});

test('applySensitivity hides detections below the setting and counts them', async () => {
  settingsRows({ detection_mode: 'HYBRID', ai_confidence_threshold: '0.6', injection_check: 'true', sensitivity_level: 'HIGH' });
  hybridWithPerson();

  const result = await runDetection(TEXT, { applySensitivity: true });

  assert.deepEqual(result.detections.map((d) => d.category), ['AADHAAR']);
  assert.equal(result.hiddenBySeverity, 1);
  assert.equal(result.minSeverity, 'HIGH');
  assert.equal(result.detectionCount, 1);
});

test('applySensitivity defaults to LOW, which hides nothing', async () => {
  hybridWithPerson();

  const result = await runDetection(TEXT, { applySensitivity: true });

  assert.equal(result.detections.length, 2);
  assert.equal(result.hiddenBySeverity, 0);
});
