const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * Fake PromptGuard API: POST /api/scan/batch flags AWS keys (CRITICAL) and
 * emails (LOW), with line/column and a masked preview like the real backend.
 */
const RULES = [
  { re: /AKIA[0-9A-Z]{16}/g, category: 'API_KEY', severity: 'CRITICAL', patternName: 'AWS Access Key' },
  { re: /[a-z0-9.]+@[a-z0-9.]+\.[a-z]{2,}/gi, category: 'EMAIL', severity: 'LOW', patternName: 'Email Address' },
];

function findings(content) {
  const out = [];
  for (const rule of RULES) {
    for (const m of content.matchAll(rule.re)) {
      const before = content.slice(0, m.index);
      const line = before.split('\n').length;
      const column = m.index - before.lastIndexOf('\n');
      out.push({
        line, column, category: rule.category, severity: rule.severity, patternName: rule.patternName,
        source: 'REGEX', confidence: null, preview: `${m[0].slice(0, 4)}****`, start: m.index, end: m.index + m[0].length,
      });
    }
  }
  return out;
}

function startFakeApi() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const send = (status, data) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      // The VS Code extension polls health; everything else but batch scans is unknown here
      if (req.method === 'GET' && req.url === '/api/health') {
        send(200, { success: true, data: { api: 'ok', database: 'ok', ml: 'ok' } });
        return;
      }
      if (req.method !== 'POST' || req.url !== '/api/scan/batch') {
        send(404, { success: false, error: 'Route not found' });
        return;
      }
      const payload = JSON.parse(body || '{}');
      requests.push(payload);
      const files = payload.files.map((f) => ({
        path: f.path, findings: findings(f.content), riskScore: 0, riskLevel: 'NONE',
        effectiveMode: 'REGEX', regexOnly: false, fellBack: false,
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { files, summary: { durationMs: 1 } } }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${server.address().port}`, requests, close: () => server.close() });
    });
  });
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'promptguard-cli-'));
}

function gitRepo() {
  const dir = tmpDir();
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  return { dir, git };
}

/** Runs main() and captures output. */
async function run(main, argv, io = {}) {
  const out = [];
  const err = [];
  const code = await main(argv, {
    env: {}, isTTY: false, out: (s) => out.push(s), err: (s) => err.push(s), ...io,
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

module.exports = { startFakeApi, tmpDir, gitRepo, run };
