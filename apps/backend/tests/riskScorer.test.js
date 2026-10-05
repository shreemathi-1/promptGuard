const { calculateRiskScore } = require('../src/services/riskScorer');

const CARD = { category: 'CREDIT_CARD', severity: 'CRITICAL' };

test('regex detections (no confidence) score as before', () => {
  expect(calculateRiskScore([CARD]).score).toBe(52); // 40 × 1.3
});

test('confidence scales a detection\'s weight', () => {
  expect(calculateRiskScore([{ ...CARD, confidence: 0.5 }]).score).toBe(26);
});

test('AI categories have their own multipliers', () => {
  expect(calculateRiskScore([{ category: 'MEDICAL', severity: 'HIGH', confidence: 1 }]).score).toBe(30);
});

test('injection adds points and forces CRITICAL above 0.9', () => {
  expect(calculateRiskScore([], { injectionScore: 0.3 }).score).toBe(0);
  expect(calculateRiskScore([], { injectionScore: 0.7 }).score).toBe(28);

  const critical = calculateRiskScore([], { injectionScore: 0.95 });
  expect(critical.score).toBe(80);
  expect(critical.level).toBe('CRITICAL');
  expect(critical.breakdown.injection).toEqual({ score: 0.95, points: 38 });
});
