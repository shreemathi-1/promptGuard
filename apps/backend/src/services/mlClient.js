const env = require('../config/env');

/**
 * HTTP client for the Python ML service (apps/ml-service).
 *
 * Every call has a timeout. After FAILURE_THRESHOLD consecutive failures the
 * circuit opens and calls fail fast for OPEN_MS, so a stopped ML service costs
 * one timeout, not one per request. Callers catch MlUnavailableError and fall
 * back to regex-only detection.
 */

const FAILURE_THRESHOLD = 3;
const OPEN_MS = 30_000;

class MlUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MlUnavailableError';
  }
}

const breaker = {
  failures : 0,
  openUntil: 0,
};

function isEnabled() {
  return Boolean(env.ml.url);
}

function isCircuitOpen() {
  return Date.now() < breaker.openUntil;
}

function recordSuccess() {
  breaker.failures = 0;
  breaker.openUntil = 0;
}

function recordFailure() {
  breaker.failures++;
  if (breaker.failures >= FAILURE_THRESHOLD) {
    breaker.openUntil = Date.now() + OPEN_MS;
    console.warn(`[ML] Circuit open for ${OPEN_MS / 1000}s after ${breaker.failures} failures`);
  }
}

async function request(method, path, body) {
  if (!isEnabled()) throw new MlUnavailableError('ML service is disabled');
  if (isCircuitOpen()) throw new MlUnavailableError('ML service circuit is open');

  let res;
  try {
    res = await fetch(`${env.ml.url}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body   : body ? JSON.stringify(body) : undefined,
      signal : AbortSignal.timeout(env.ml.timeoutMs),
    });
  } catch (err) {
    recordFailure();
    throw new MlUnavailableError(`ML service unreachable: ${err.message}`);
  }

  if (res.status >= 500) {
    recordFailure();
    throw new MlUnavailableError(`ML service ${path} returned ${res.status}`);
  }

  const data = await res.json();
  if (!res.ok) {
    // 4xx is a bad request from us, not an outage — don't trip the breaker
    throw new Error(`ML service ${path} rejected request (${res.status}): ${JSON.stringify(data.detail ?? data)}`);
  }

  recordSuccess();
  return data;
}

/** Finds AI entities. entities: 'ai' (names, places, ...) | 'all' (also structured PII). */
function detect(text, { entities = 'ai', threshold = 0.5 } = {}) {
  return request('POST', '/detect', { text, entities, threshold });
}

/** Scores regex hits: [{ category, match, start, end }] → { results: [{ index, confidence, checksum, reasons }] } */
function validate(text, hits) {
  return request('POST', '/validate', { text, hits });
}

/** Prompt-injection probability → { score, label, isInjection, model } */
function injection(text) {
  return request('POST', '/injection', { text });
}

function health() {
  return request('GET', '/health');
}

/** Test helper: closes the circuit. */
function resetBreaker() {
  breaker.failures = 0;
  breaker.openUntil = 0;
}

module.exports = {
  detect,
  validate,
  injection,
  health,
  isEnabled,
  isCircuitOpen,
  resetBreaker,
  MlUnavailableError,
};
