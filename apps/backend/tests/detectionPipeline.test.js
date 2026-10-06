jest.mock('../src/config/db', () => ({ query: jest.fn() }));
jest.mock('../src/services/mlClient');
jest.mock('../src/services/scanner', () => ({
  ...jest.requireActual('../src/services/scanner'),
  findMatches: jest.fn(),
}));

const { query } = require('../src/config/db');
const mlClient = require('../src/services/mlClient');
const { findMatches } = require('../src/services/scanner');
const { runDetection } = require('../src/services/detectionPipeline');

const TEXT = 'Priya Sharma, order 1234 5678 9012';

// Same span matched by two rules: Aadhaar (HIGH) would normally hide the bank account hit
const AADHAAR = { patternId: 'p1', patternName: 'Aadhaar Number', category: 'AADHAAR', severity: 'HIGH', match: '1234 5678 9012', start: 20, end: 34, length: 14 };
const BANK = { patternId: 'p2', patternName: 'US Bank Account Number', category: 'BANK_ACCOUNT', severity: 'HIGH', match: '1234', start: 20, end: 24, length: 4 };
const PERSON = { entityType: 'PERSON', category: 'PERSON', severity: 'MEDIUM', match: 'Priya Sharma', start: 0, end: 12, confidence: 0.98, recognizer: 'TransformersRecognizer' };

function settingsRows(rows) {
  query.mockResolvedValue({ rows: Object.entries(rows).map(([key, value]) => ({ key, value })) });
}

beforeEach(() => {
  jest.resetAllMocks();
  settingsRows({ detection_mode: 'HYBRID', ai_confidence_threshold: '0.6', injection_check: 'true' });
  findMatches.mockResolvedValue({ matches: [AADHAAR, BANK], patternCount: 2 });
  mlClient.isEnabled.mockReturnValue(true);
  mlClient.isCircuitOpen.mockReturnValue(false);
  mlClient.injection.mockResolvedValue({ score: 0.02, label: 'SAFE', isInjection: false, model: 'm' });
  mlClient.detect.mockResolvedValue({ entities: [PERSON] });
});

test('HYBRID drops low-confidence regex hits and adds AI entities', async () => {
  mlClient.validate.mockResolvedValue({
    results: [
      { index: 0, confidence: 0.1, checksum: false, reasons: ['verhoeff_invalid'] },
      { index: 1, confidence: 0.65, checksum: null, reasons: ['context:account'] },
    ],
  });

  const result = await runDetection(TEXT);

  expect(result.effectiveMode).toBe('HYBRID');
  expect(result.aiAvailable).toBe(true);
  expect(result.filteredCount).toBe(1);
  expect(result.filtered[0].category).toBe('AADHAAR');
  expect(result.detections.map((d) => [d.category, d.source])).toEqual([
    ['BANK_ACCOUNT', 'HYBRID'],
    ['PERSON', 'AI'],
  ]);
  expect(result.aiDetectionCount).toBe(1);
  expect(mlClient.detect).toHaveBeenCalledWith(TEXT, { entities: 'ai', threshold: 0.6 });
});

test('falls back to regex when the ML service is down', async () => {
  const down = new Error('ML service unreachable');
  mlClient.validate.mockRejectedValue(down);
  mlClient.detect.mockRejectedValue(down);
  mlClient.injection.mockRejectedValue(down);

  const result = await runDetection(TEXT);

  expect(result.mode).toBe('HYBRID');
  expect(result.effectiveMode).toBe('REGEX');
  expect(result.aiAvailable).toBe(false);
  expect(result.injection).toBeNull();
  // Regex dedupe keeps the original behaviour: one hit for the overlapping span
  expect(result.detections).toHaveLength(1);
  expect(result.detections[0]).toMatchObject({ source: 'REGEX', confidence: null });
});

test('REGEX mode never calls the detector or validator', async () => {
  const result = await runDetection(TEXT, { mode: 'REGEX' });

  expect(mlClient.validate).not.toHaveBeenCalled();
  expect(mlClient.detect).not.toHaveBeenCalled();
  expect(result.detections.every((d) => d.source === 'REGEX')).toBe(true);
  expect(result.injection).toMatchObject({ label: 'SAFE' });
});

test('AI mode asks for all entity types and ignores regex hits', async () => {
  const result = await runDetection(TEXT, { mode: 'AI' });

  expect(mlClient.detect).toHaveBeenCalledWith(TEXT, { entities: 'all', threshold: 0.6 });
  expect(mlClient.validate).not.toHaveBeenCalled();
  expect(result.detections).toHaveLength(1);
  expect(result.detections[0]).toMatchObject({ category: 'PERSON', source: 'AI', patternId: null });
});

test('reports injection and respects injection_check', async () => {
  mlClient.validate.mockResolvedValue({ results: [] });
  mlClient.injection.mockResolvedValue({ score: 0.97, label: 'INJECTION', isInjection: true, model: 'm' });
  expect((await runDetection(TEXT)).injection).toMatchObject({ isInjection: true, score: 0.97 });

  settingsRows({ injection_check: 'false', detection_mode: 'REGEX' });
  mlClient.injection.mockClear();
  const result = await runDetection(TEXT);
  expect(mlClient.injection).not.toHaveBeenCalled();
  expect(result.injection).toBeNull();
});

test('uses defaults when settings cannot be read', async () => {
  query.mockRejectedValue(new Error('db down'));
  mlClient.validate.mockResolvedValue({ results: [] });

  const result = await runDetection(TEXT);

  expect(result.mode).toBe('HYBRID');
  expect(result.threshold).toBe(0.6);
});
