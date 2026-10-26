/**
 * Client for the backend's POST /api/scan/batch.
 *
 * Splits large scans into batches under the server's limits and merges the
 * results. Network failures raise ApiUnreachableError (the pre-commit hook can
 * choose to let the commit through); any other failure raises ApiError.
 */

const MAX_FILES_PER_BATCH = 100;
const MAX_CHARS_PER_BATCH = 4_000_000;

class ApiUnreachableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ApiUnreachableError';
  }
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function chunk(files) {
  const batches = [];
  let current = [];
  let size = 0;
  for (const f of files) {
    if (current.length && (current.length >= MAX_FILES_PER_BATCH || size + f.content.length > MAX_CHARS_PER_BATCH)) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(f);
    size += f.content.length;
  }
  if (current.length) batches.push(current);
  return batches;
}

async function postBatch(api, files, mode, timeoutMs) {
  let res;
  try {
    res = await fetch(`${api.replace(/\/+$/, '')}/api/scan/batch`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'promptguard-cli' },
      body   : JSON.stringify({ files, mode }),
      signal : AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? `timed out after ${timeoutMs / 1000}s` : (err.cause?.code ?? err.message);
    throw new ApiUnreachableError(`PromptGuard API not reachable at ${api} (${reason})`);
  }

  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    throw new ApiError(body?.error ?? `API returned HTTP ${res.status}`, res.status);
  }
  return body.data;
}

/**
 * @param {string} api — base URL, e.g. http://localhost:4000
 * @param {{ path: string, content: string }[]} files
 * @param {{ mode?: string, timeoutMs?: number }} [opts]
 * @returns {Promise<{ files: object[], summary: object }>}
 */
async function scanFiles(api, files, { mode, timeoutMs = 120_000 } = {}) {
  const results = [];
  let durationMs = 0;
  for (const batch of chunk(files)) {
    const data = await postBatch(api, batch, mode, timeoutMs);
    results.push(...data.files);
    durationMs += data.summary.durationMs;
  }
  return {
    files: results,
    summary: {
      filesFellBack : results.filter((f) => f.fellBack).length,
      filesRegexOnly: results.filter((f) => f.regexOnly).length,
      durationMs,
    },
  };
}

module.exports = { scanFiles, chunk, ApiError, ApiUnreachableError, MAX_FILES_PER_BATCH, MAX_CHARS_PER_BATCH };
