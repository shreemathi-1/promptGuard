const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { stub, mock } = require('./helpers');

stub('src/config/env', { ml: { url: 'http://ml.test', timeoutMs: 100, llmTimeoutMs: 1000 } });
const mlClient = require('../src/services/mlClient');

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  mlClient.resetBreaker();
  global.fetch = mock.fn();
});

test('opens the circuit after 3 failures and then fails fast', async () => {
  global.fetch.mock.mockImplementation(async () => { throw new Error('ECONNREFUSED'); });

  for (let i = 0; i < 3; i++) {
    await assert.rejects(mlClient.injection('x'), mlClient.MlUnavailableError);
  }
  assert.equal(mlClient.isCircuitOpen(), true);
  await assert.rejects(mlClient.injection('x'), /circuit is open/);
  assert.equal(global.fetch.mock.callCount(), 3);
});

test('a 4xx response does not trip the breaker', async () => {
  global.fetch.mock.mockImplementation(async () => ({ ok: false, status: 422, json: async () => ({ detail: 'bad' }) }));
  for (let i = 0; i < 4; i++) {
    await assert.rejects(mlClient.validate('x', []), /rejected request \(422\)/);
  }
  assert.equal(mlClient.isCircuitOpen(), false);
});

test('a success resets the failure count', async () => {
  const replies = [new Error('timeout'), new Error('timeout'), ok({ score: 0 }), new Error('timeout')];
  global.fetch.mock.mockImplementation(async () => {
    const r = replies.shift();
    if (r instanceof Error) throw r;
    return r;
  });
  await assert.rejects(mlClient.injection('x'));
  await assert.rejects(mlClient.injection('x'));
  assert.deepEqual(await mlClient.injection('x'), { score: 0 });
  await assert.rejects(mlClient.injection('x'));
  assert.equal(mlClient.isCircuitOpen(), false);
});

test('breaker: false calls (LLM, batch) never trip or check the circuit', async () => {
  global.fetch.mock.mockImplementation(async () => { throw new Error('timeout'); });
  for (let i = 0; i < 5; i++) {
    await assert.rejects(mlClient.detect('x', {}, { breaker: false }), mlClient.MlUnavailableError);
  }
  assert.equal(mlClient.isCircuitOpen(), false);
});

test('503 LLM_UNAVAILABLE is an LlmUnavailableError and keeps the circuit closed', async () => {
  global.fetch.mock.mockImplementation(async () => ({
    ok: false, status: 503, json: async () => ({ detail: { code: 'LLM_UNAVAILABLE', message: 'Ollama unreachable' } }),
  }));
  for (let i = 0; i < 4; i++) {
    await assert.rejects(mlClient.generateRule({ description: 'x', examples: ['y'] }), mlClient.LlmUnavailableError);
  }
  assert.equal(mlClient.isCircuitOpen(), false);
});

test('per-call timeout is passed to fetch', async () => {
  global.fetch.mock.mockImplementation(async () => ok({ entities: [] }));
  await mlClient.detect('x', {}, { timeoutMs: 60_000, breaker: false });
  const [, init] = global.fetch.mock.calls[0].arguments;
  assert.ok(init.signal instanceof AbortSignal);
});
