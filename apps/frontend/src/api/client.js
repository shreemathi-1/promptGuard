import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const http = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15_000,
});

// Unwrap { success, data } envelope; surface error messages cleanly
http.interceptors.response.use(
  (res) => res.data,
  (err) => {
    const message =
      err.response?.data?.error ||
      err.message ||
      'Unexpected error';
    return Promise.reject(new Error(message));
  }
);

// ── Health ────────────────────────────────────────────────────────────────

export async function fetchHealth() {
  const res = await http.get('/api/health');
  return res.data;
}

// ── Scan ──────────────────────────────────────────────────────────────────

/**
 * @param {string} text
 * @param {'REGEX'|'AI'|'HYBRID'} [mode] — omit to use the detection_mode setting
 * @returns {Promise<ScanResult>}
 */
export async function scanText(text, mode) {
  const res = await http.post('/api/scan', { text, mode });
  return res.data;
}

// ── Mask ──────────────────────────────────────────────────────────────────

/**
 * @param {string} text
 * @param {'REDACT'|'PARTIAL'|'TOKENIZE'} style
 * @param {'REGEX'|'AI'|'HYBRID'} [mode] — omit to use the detection_mode setting
 * @returns {Promise<MaskResult>}
 */
export async function maskText(text, style = 'REDACT', mode) {
  const res = await http.post('/api/mask', { text, style, mode });
  return res.data;
}

// ── Smart Rewrite ─────────────────────────────────────────────────────────

/**
 * Swaps sensitive values for realistic fakes.
 * @param {string} text
 * @param {object} [opts]
 * @param {'REGEX'|'AI'|'HYBRID'} [opts.mode]
 * @param {string} [opts.mappingId] — reuse fakes from an earlier rewrite
 * @returns {Promise<RewriteResult>}
 */
export async function rewriteText(text, { mode, mappingId } = {}) {
  const res = await http.post('/api/ai/rewrite', { text, mode, mappingId });
  return res.data;
}

/**
 * Puts the original values back into a chatbot reply.
 * @param {string} mappingId
 * @param {string} text
 * @returns {Promise<{ text, restoredCount, restored }>}
 */
export async function restoreText(mappingId, text) {
  const res = await http.post('/api/ai/restore', { mappingId, text });
  return res.data;
}

/** Forgets a rewrite mapping before it expires. */
export async function forgetRewrite(mappingId) {
  const res = await http.delete(`/api/ai/rewrite/${encodeURIComponent(mappingId)}`);
  return res.data;
}

// ── AI: rule generator + explanations ─────────────────────────────────────

// Local LLM calls (Ollama) can take a while on a laptop
const LLM_TIMEOUT_MS = 160_000;

/**
 * Asks the local LLM for a regex, tested against the examples. Nothing is saved.
 * @param {{ description: string, examples: string[], negatives?: string[], category?: string }} payload
 * @returns {Promise<{ rule, tests, verified, attempts, model, durationMs }>}
 */
export async function generateRule(payload) {
  const res = await http.post('/api/rules/generate', payload, { timeout: LLM_TIMEOUT_MS });
  return res.data;
}

/**
 * "Why is this risky?" for one detection.
 * @param {object} payload — { category, match, context, source, confidence, reasons, recognizer, useLlm }
 * @returns {Promise<{ explanation: { summary, risks, recommendation }, evidence, source, model }>}
 */
export async function explainDetection(payload) {
  const res = await http.post('/api/ai/explain', payload, payload.useLlm ? { timeout: LLM_TIMEOUT_MS } : undefined);
  return res.data;
}

// ── Audit ─────────────────────────────────────────────────────────────────

/**
 * @param {object} params
 * @param {number}  [params.page=1]
 * @param {number}  [params.pageSize=20]
 * @param {string}  [params.sortBy='created_at']
 * @param {string}  [params.sortDir='DESC']
 * @param {number}  [params.minRisk]
 * @param {number}  [params.maxRisk]
 * @param {string}  [params.style]
 * @param {string}  [params.category]
 * @param {string}  [params.dateFrom]
 * @param {string}  [params.dateTo]
 * @param {boolean} [params.hasDetections]
 * @returns {Promise<{ records: AuditRecord[], pagination: Pagination }>}
 */
export async function fetchAuditLogs(params = {}) {
  // Strip undefined values so they don't appear as "undefined" in query string
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
  );
  const res = await http.get('/api/audit', { params: clean });
  return res.data;
}

/**
 * @param {string} id - UUID
 * @returns {Promise<AuditRecord>}
 */
export async function fetchAuditLog(id) {
  const res = await http.get(`/api/audit/${id}`);
  return res.data;
}

// ── Rules ─────────────────────────────────────────────────────────────────────

/**
 * @param {object} [params]
 * @param {string}  [params.category]
 * @param {string}  [params.severity]
 * @param {boolean} [params.isActive]
 * @param {boolean} [params.isBuiltin]
 */
export async function fetchRules(params = {}) {
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
  );
  // Add cache‑busting timestamp to every request
  const queryParams = { ...clean, _: Date.now() };
  const res = await http.get('/api/rules', {
    params: queryParams,
    headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
  });
  // `res` is the envelope { success, data } due to interceptor
  return res?.data ?? { rules: [], total: 0 };
}

/**
 * @param {string} id
 */
export async function fetchRule(id) {
  const res = await http.get(`/api/rules/${id}`);
  return res.data;
}

/**
 * @param {{ name, pattern, category, severity, description?, isActive? }} payload
 */
export async function createRule(payload) {
  const res = await http.post('/api/rules', payload);
  return res.data;
}

/**
 * @param {string} id
 * @param {object} payload — partial fields to update
 */
export async function updateRule(id, payload) {
  const res = await http.put(`/api/rules/${id}`, payload);
  return res.data;
}

/**
 * @param {string} id
 */
export async function deleteRule(id) {
  const res = await http.delete(`/api/rules/${id}`);
  return res.data;
}

/**
 * @param {string} id
 */
export async function toggleRule(id) {
  const res = await http.patch(`/api/rules/${id}/toggle`);
  return res.data;
}

// ── Risk ──────────────────────────────────────────────────────────────────────

/**
 * @param {number} [days=7] — look-back window (1–90)
 * @returns {Promise<RiskSummary>}
 */
export async function fetchRiskSummary(days = 7) {
  const res = await http.get('/api/risk/summary', { params: { days } });
  return res.data;
}

/**
 * Score a detections array on demand.
 * @param {Detection[]} detections
 * @param {number|null} [injectionScore] — prompt-injection probability (0–1)
 * @returns {Promise<ScoreResult>}
 */
export async function scoreDetections(detections, injectionScore = null) {
  const res = await http.post('/api/risk/score', { detections, injectionScore });
  return res.data;
}

// ── Export ────────────────────────────────────────────────────────────────────

/**
 * Returns available export column definitions.
 * @returns {Promise<{ columns, defaultColumns }>}
 */
export async function fetchExportColumns() {
  const res = await http.get('/api/export/columns');
  return res.data;
}

/**
 * Builds the export URL with query params.
 * The browser navigates to this URL to trigger a file download.
 *
 * @param {object} params
 * @param {string}   [params.format='csv']       — 'csv' | 'json'
 * @param {string[]} [params.columns]            — column keys
 * @param {number}   [params.limit=1000]
 * @param {number}   [params.minRisk]
 * @param {number}   [params.maxRisk]
 * @param {string}   [params.style]
 * @param {string}   [params.dateFrom]
 * @param {string}   [params.dateTo]
 * @param {boolean}  [params.hasDetections]
 * @param {string}   [params.sortBy='created_at']
 * @param {string}   [params.sortDir='DESC']
 * @returns {string} — full URL string
 */
export function buildExportUrl(params = {}) {
  const url = new URL('/api/export/audit', BASE_URL);

  // Columns — join array to comma-separated string
  if (params.columns && params.columns.length > 0) {
    url.searchParams.set('columns', params.columns.join(','));
  }

  const directParams = [
    'format', 'limit', 'minRisk', 'maxRisk',
    'style', 'dateFrom', 'dateTo',
    'hasDetections', 'sortBy', 'sortDir',
  ];

  for (const key of directParams) {
    if (params[key] !== undefined && params[key] !== '' && params[key] !== null) {
      url.searchParams.set(key, String(params[key]));
    }
  }

  return url.toString();
}
// ── Settings ──────────────────────────────────────────────────────────────────

/**
 * Fetches all system settings.
 * @returns {Promise<{ settings: Setting[] }>}
 */
export async function fetchSettings() {
  const res = await http.get('/api/settings');
  return res.data;
}

/**
 * Fetches a single setting by key.
 * @param {string} key
 * @returns {Promise<Setting>}
 */
export async function fetchSetting(key) {
  const res = await http.get(`/api/settings/${key}`);
  return res.data;
}

/**
 * Updates a single setting.
 * @param {string} key
 * @param {string} value
 * @returns {Promise<Setting>}
 */
export async function updateSetting(key, value) {
  const res = await http.put(`/api/settings/${key}`, { value });
  return res.data;
}

/**
 * Updates multiple settings in one request.
 * @param {{ [key: string]: string }} settings
 * @returns {Promise<{ updated: Setting[], errors: { key, error }[] }>}
 */
export async function updateSettings(settings) {
  const res = await http.put('/api/settings', { settings });
  return res.data;
}