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

/** The ML service is up, but its optional local LLM (Ollama) is not. */
class LlmUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LlmUnavailableError';
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

/**
 * @param {object} [opts]
 * @param {number}  [opts.timeoutMs] — defaults to ML_TIMEOUT_MS
 * @param {boolean} [opts.breaker=true] — false for slow LLM calls, so a
 *        missing or slow Ollama never switches off AI detection
 */
async function request(method, path, body, { timeoutMs = env.ml.timeoutMs, breaker: useBreaker = true } = {}) {
  if (!isEnabled()) throw new MlUnavailableError('ML service is disabled');
  if (useBreaker && isCircuitOpen()) throw new MlUnavailableError('ML service circuit is open');

  let res;
  try {
    res = await fetch(`${env.ml.url}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body   : body ? JSON.stringify(body) : undefined,
      signal : AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (useBreaker) recordFailure();
    throw new MlUnavailableError(`ML service unreachable: ${err.message}`);
  }

  if (res.status === 503 || res.status === 502) {
    // The ML service answered, so it's up; only its LLM is missing or misbehaving
    const data = await res.json().catch(() => null);
    const code = data?.detail?.code;
    if (code === 'LLM_UNAVAILABLE' || code === 'LLM_BAD_RESPONSE') {
      const err = new LlmUnavailableError(data.detail.message);
      err.code = code;
      throw err;
    }
    if (useBreaker) recordFailure();
    throw new MlUnavailableError(`ML service ${path} returned ${res.status}`);
  }

  if (res.status >= 500) {
    if (useBreaker) recordFailure();
    throw new MlUnavailableError(`ML service ${path} returned ${res.status}`);
  }

  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) {
    // 4xx is a bad request from us, not an outage — don't trip the breaker
    if (useBreaker) recordSuccess();
    const err = new Error(`ML service ${path} rejected request (${res.status}): ${JSON.stringify(data?.detail ?? data)}`);
    err.status = res.status;
    err.detail = data?.detail;
    throw err;
  }

  if (useBreaker) recordSuccess();
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

/**
 * Smart rewrite: swaps detections for realistic fakes.
 * Pass mappingId from an earlier rewrite to keep the same fakes.
 * → { text, mappingId, replacements: [{ category, original, fake, start, end, fakeStart, fakeEnd }], ttlSeconds }
 */
function pseudonymize(text, entities, mappingId) {
  return request('POST', '/pseudonymize', { text, entities, mappingId: mappingId || undefined });
}

/** Puts the original values back into text (e.g. a chatbot's reply) → { text, restoredCount, restored } */
function restore(mappingId, text) {
  return request('POST', '/restore', { mappingId, text });
}

/** Drops a rewrite mapping before its TTL. */
function forgetMapping(mappingId) {
  return request('DELETE', `/mappings/${encodeURIComponent(mappingId)}`);
}

/**
 * AI rule generator (needs Ollama).
 * → { rule: { pattern, name, category, severity, explanation, problems, warnings, results, allPassed }, attempts, model }
 */
function generateRule({ description, examples, negatives = [], category }) {
  return request('POST', '/generate-rule', { description, examples, negatives, category },
    { timeoutMs: env.ml.llmTimeoutMs, breaker: false });
}

/**
 * "Why is this risky?" for one detection. useLlm: false → instant template; true → needs Ollama.
 * → { category, explanation: { summary, risks, recommendation }, evidence, source, model }
 */
function explain(payload) {
  return request('POST', '/explain', payload,
    payload.useLlm ? { timeoutMs: env.ml.llmTimeoutMs, breaker: false } : undefined);
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
  pseudonymize,
  restore,
  forgetMapping,
  generateRule,
  explain,
  health,
  isEnabled,
  isCircuitOpen,
  resetBreaker,
  MlUnavailableError,
  LlmUnavailableError,
};
