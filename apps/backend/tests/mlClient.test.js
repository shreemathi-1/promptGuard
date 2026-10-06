jest.mock('../src/config/env', () => ({ ml: { url: 'http://ml.test', timeoutMs: 100 } }));

const mlClient = require('../src/services/mlClient');

beforeEach(() => {
  mlClient.resetBreaker();
  global.fetch = jest.fn();
});

test('opens the circuit after 3 failures and then fails fast', async () => {
  global.fetch.mockRejectedValue(new Error('ECONNREFUSED'));

  for (let i = 0; i < 3; i++) {
    await expect(mlClient.injection('x')).rejects.toBeInstanceOf(mlClient.MlUnavailableError);
  }
  expect(mlClient.isCircuitOpen()).toBe(true);

  await expect(mlClient.injection('x')).rejects.toThrow('circuit is open');
  expect(global.fetch).toHaveBeenCalledTimes(3);
});

test('a 4xx response does not trip the breaker', async () => {
  global.fetch.mockResolvedValue({ ok: false, status: 422, json: async () => ({ detail: 'bad' }) });

  for (let i = 0; i < 4; i++) {
    await expect(mlClient.validate('x', [])).rejects.toThrow('rejected request (422)');
  }
  expect(mlClient.isCircuitOpen()).toBe(false);
});

test('a success resets the failure count', async () => {
  global.fetch
    .mockRejectedValueOnce(new Error('timeout'))
    .mockRejectedValueOnce(new Error('timeout'))
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ score: 0 }) })
    .mockRejectedValueOnce(new Error('timeout'));

  await expect(mlClient.injection('x')).rejects.toThrow();
  await expect(mlClient.injection('x')).rejects.toThrow();
  await expect(mlClient.injection('x')).resolves.toEqual({ score: 0 });
  await expect(mlClient.injection('x')).rejects.toThrow();
  expect(mlClient.isCircuitOpen()).toBe(false);
});
