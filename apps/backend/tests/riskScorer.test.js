const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculateRiskScore } = require('../src/services/riskScorer');

const CARD = { category: 'CREDIT_CARD', severity: 'CRITICAL' };

test('regex detections (no confidence) score as before', () => {
  assert.equal(calculateRiskScore([CARD]).score, 52); // 40 × 1.3
});

test("confidence scales a detection's weight", () => {
  assert.equal(calculateRiskScore([{ ...CARD, confidence: 0.5 }]).score, 26);
});

test('AI categories have their own multipliers', () => {
  assert.equal(calculateRiskScore([{ category: 'MEDICAL', severity: 'HIGH', confidence: 1 }]).score, 30);
});

test('injection adds points and forces CRITICAL above 0.9', () => {
  assert.equal(calculateRiskScore([], { injectionScore: 0.3 }).score, 0);
  assert.equal(calculateRiskScore([], { injectionScore: 0.7 }).score, 28);

  const critical = calculateRiskScore([], { injectionScore: 0.95 });
  assert.equal(critical.score, 80);
  assert.equal(critical.level, 'CRITICAL');
  assert.deepEqual(critical.breakdown.injection, { score: 0.95, points: 38 });
});
