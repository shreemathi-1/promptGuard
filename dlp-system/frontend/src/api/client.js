import axios from 'axios';

const BASE_URL = 'http://localhost:4000';

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
 * @returns {Promise<ScanResult>}
 */
export async function scanText(text) {
  const res = await http.post('/api/scan', { text });
  return res.data;
}

// ── Mask ──────────────────────────────────────────────────────────────────

/**
 * @param {string} text
 * @param {'REDACT'|'PARTIAL'|'TOKENIZE'} style
 * @returns {Promise<MaskResult>}
 */
export async function maskText(text, style = 'REDACT') {
  const res = await http.post('/api/mask', { text, style });
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
  const res = await http.get('/api/rules', { params: clean });
  return res.data;
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
 * @returns {Promise<ScoreResult>}
 */
export async function scoreDetections(detections) {
  const res = await http.post('/api/risk/score', { detections });
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
  const url = new URL('http://localhost:4000/api/export/audit');

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