const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stub, mock } = require('./helpers');

stub('src/config/db', { query: mock.fn() });
const { deduplicateMatches } = require('../src/services/scanner');
const { mask } = require('../src/services/masker');

const m = (category, start, end, severity, source, confidence) => ({ category, start, end, severity, source, confidence, match: 'x'.repeat(end - start) });

test('dedupe prefers a rule match over an overlapping AI guess', () => {
  // NER tags "IFSC ICIC0896383" as an ORGANIZATION; the IFSC rule matches inside it
  const kept = deduplicateMatches([m('ORGANIZATION', 13, 29, 'LOW', 'AI', 0.8), m('IFSC', 18, 29, 'HIGH', 'HYBRID', 0.95)]);
  assert.deepEqual(kept.map((k) => k.category), ['IFSC']);
});

test('dedupe prefers the longer span among rule matches', () => {
  // "+91-8994717464": the account-number-shaped digits are inside the phone number
  const kept = deduplicateMatches([m('BANK_ACCOUNT', 4, 14, 'HIGH', 'REGEX'), m('PHONE', 0, 14, 'MEDIUM', 'REGEX')]);
  assert.deepEqual(kept.map((k) => k.category), ['PHONE']);
});

test('dedupe falls back to severity, then confidence, and keeps position order', () => {
  const same = deduplicateMatches([m('A', 0, 5, 'LOW', 'REGEX'), m('B', 0, 5, 'HIGH', 'REGEX')]);
  assert.deepEqual(same.map((k) => k.category), ['B']);
  const apart = deduplicateMatches([m('LATE', 20, 25, 'LOW'), m('EARLY', 0, 5, 'LOW')]);
  assert.deepEqual(apart.map((k) => k.category), ['EARLY', 'LATE']);
});

test('masker passes source and confidence to replacements', () => {
  const text = 'call Priya now';
  const result = mask(text, [{ category: 'PERSON', severity: 'MEDIUM', match: 'Priya', start: 5, end: 10, source: 'AI', confidence: 0.9 }], 'REDACT');
  assert.equal(result.maskedText, 'call [PERSON REDACTED] now');
  assert.equal(result.replacements[0].source, 'AI');
  assert.equal(result.replacements[0].confidence, 0.9);
});
