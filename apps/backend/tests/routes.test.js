jest.mock('../src/config/db', () => ({ query: jest.fn(), pool: { query: jest.fn() }, testConnection: jest.fn() }));
jest.mock('../src/services/detectionPipeline', () => ({
  ...jest.requireActual('../src/services/detectionPipeline'),
  runDetection: jest.fn(),
}));
jest.mock('../src/services/auditLogger', () => ({
  writeAuditLog: jest.fn().mockResolvedValue({}),
  extractIp: jest.fn(() => '127.0.0.1'),
}));

const request = require('supertest');
const app = require('../src/app');
const { runDetection } = require('../src/services/detectionPipeline');
const { writeAuditLog } = require('../src/services/auditLogger');

const RESULT = {
  detections: [{ patternId: null, patternName: 'Person Name', category: 'PERSON', severity: 'MEDIUM', match: 'Priya', start: 0, end: 5, length: 5, source: 'AI', confidence: 0.9 }],
  detectionCount: 1,
  mode: 'HYBRID',
  effectiveMode: 'HYBRID',
  aiAvailable: true,
  aiDetectionCount: 1,
  filteredCount: 0,
  filtered: [],
  injection: { score: 0.96, label: 'INJECTION', isInjection: true, model: 'm' },
};

beforeEach(() => {
  jest.clearAllMocks();
  runDetection.mockResolvedValue(RESULT);
});

test('POST /api/scan passes mode through and logs AI fields', async () => {
  const res = await request(app).post('/api/scan').send({ text: 'Priya here', mode: 'AI' });

  expect(res.status).toBe(200);
  expect(res.body.data.injection.isInjection).toBe(true);
  expect(runDetection).toHaveBeenCalledWith('Priya here', { mode: 'AI' });
  expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
    detectionMode: 'HYBRID', injectionScore: 0.96, aiDetectionCount: 1,
  }));
});

test('POST /api/scan rejects an unknown mode', async () => {
  const res = await request(app).post('/api/scan').send({ text: 'hi', mode: 'MAGIC' });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/"mode" must be one of/);
});

test('POST /api/mask masks AI detections', async () => {
  const res = await request(app).post('/api/mask').send({ text: 'Priya here', style: 'REDACT' });

  expect(res.status).toBe(200);
  expect(res.body.data.maskedText).not.toContain('Priya');
  expect(res.body.data.aiAvailable).toBe(true);
});
