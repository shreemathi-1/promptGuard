/**
 * HTTP client for the PromptGuard backend (everything except batch scans,
 * which go through the CLI's client so both behave identically).
 */

const DEFAULT_TIMEOUT_MS = 30_000;
const LLM_TIMEOUT_MS = 160_000;

class BackendUnreachableError extends Error {
  constructor(apiUrl, cause) {
    super(`PromptGuard backend not reachable at ${apiUrl}${cause ? ` (${cause})` : ''}`);
    this.name = 'BackendUnreachableError';
  }
}

class BackendError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'BackendError';
    this.status = status;
  }
}

class Client {
  /** @param {() => string} getApiUrl — read lazily so settings changes apply immediately */
  constructor(getApiUrl) {
    this.getApiUrl = getApiUrl;
  }

  get apiUrl() {
    return this.getApiUrl().replace(/\/+$/, '');
  }

  async request(method, path, body, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const apiUrl = this.apiUrl;
    let res;
    try {
      res = await fetch(`${apiUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'promptguard-vscode' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const reason = err.name === 'TimeoutError' ? `timed out after ${timeoutMs / 1000}s` : (err.cause?.code ?? err.message);
      throw new BackendUnreachableError(apiUrl, reason);
    }
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      throw new BackendError(json?.error ?? `HTTP ${res.status}`, res.status);
    }
    return json.data;
  }

  /** → { api, database, ml, ... } */
  health() {
    return this.request('GET', '/api/health', undefined, 5_000);
  }

  /** Single-text scan, including the prompt-injection check. */
  scan(text, mode) {
    return this.request('POST', '/api/scan', { text, mode: mode || undefined });
  }

  /** → { maskedText, maskedCount, replacements, detections, ... } */
  mask(text, style, mode) {
    return this.request('POST', '/api/mask', { text, style, mode: mode || undefined });
  }

  /** Smart Rewrite → { rewrittenText, mappingId, replacements, injection, ... } */
  rewrite(text, { mode, mappingId } = {}) {
    return this.request('POST', '/api/ai/rewrite', { text, mode: mode || undefined, mappingId: mappingId || undefined });
  }

  /** → { text, restoredCount } */
  restore(mappingId, text) {
    return this.request('POST', '/api/ai/restore', { mappingId, text });
  }

  /** AI rule generator → { rule, tests, verified, attempts, model } */
  generateRule(payload) {
    return this.request('POST', '/api/rules/generate', payload, LLM_TIMEOUT_MS);
  }

  createRule(rule) {
    return this.request('POST', '/api/rules', rule);
  }
}

module.exports = { Client, BackendError, BackendUnreachableError };
