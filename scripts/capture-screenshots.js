#!/usr/bin/env node
/**
 * Captures the README screenshots (docs/screenshots/*.png) by driving headless
 * Chrome over the DevTools protocol — clicking the same buttons a user would.
 * No dependencies: Node 22+ (built-in WebSocket) and a local Chrome.
 *
 * Needs the app running: frontend on :5173, backend on :4000, ML service on :8000.
 * Note: the Scan and Rewrite shots run real scans, which add audit-log rows.
 *
 * Usage: node scripts/capture-screenshots.js [--base http://localhost:5173]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : 'http://localhost:5173';
const OUT = path.resolve(__dirname, '..', 'docs', 'screenshots');
const PORT = 9333;
const WIDTH = 1280;
const CHROME = process.env.CHROME_PATH ?? {
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  linux: 'google-chrome',
  win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
}[process.platform];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Helpers injected into the page: click by visible text, wait for text. */
const PAGE_HELPERS = `
  window.__pg = {
    click(text) {
      const el = [...document.querySelectorAll('button, summary')].find((b) => b.textContent.includes(text) && !b.disabled);
      if (!el) throw new Error('no button: ' + text);
      el.click();
    },
    async waitForText(text, timeout = 20000) {
      const until = Date.now() + timeout;
      // innerText applies CSS text-transform, so compare case-insensitively
      while (!document.body.innerText.toLowerCase().includes(text.toLowerCase())) {
        if (Date.now() > until) throw new Error('timed out waiting for: ' + text);
        await new Promise((r) => setTimeout(r, 100));
      }
    },
  };`;

const SHOTS = [
  {
    file: 'scan.png',
    url: '/scan',
    steps: [
      ['click', 'Name + Aadhaar + injection'],
      ['click', '🔍 Scan'],
      ['wait', 'detections found'],
      ['click', 'Why is this risky?'],
      ['wait', 'Why it was flagged'],
    ],
  },
  {
    file: 'rewrite.png',
    url: '/rewrite',
    steps: [
      ['click', 'Email draft'],
      ['click', '✨ Rewrite'],
      ['wait', 'Copy the rewritten prompt'],
      ['click', 'Use sample reply'],
      ['click', '↩ Restore'],
      ['wait', 'put back'],
    ],
  },
  { file: 'benchmark.png', url: '/benchmark', steps: [['wait', 'F1 by category']] },
  { file: 'dashboard.png', url: '/', steps: [['wait', 'Risk Analytics'], ['wait', 'Avg Risk']] },
];

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    };
  }

  open() {
    return new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
}

async function waitForChrome() {
  for (let i = 0; i < 50; i++) {
    try {
      return await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    } catch {
      await sleep(200);
    }
  }
  throw new Error('Chrome did not start');
}

async function main() {
  if (!fs.existsSync(CHROME) && process.platform === 'darwin') throw new Error(`Chrome not found at ${CHROME}; set CHROME_PATH`);
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-shots-'));
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--hide-scrollbars', '--disable-gpu', `--window-size=${WIDTH},900`, 'about:blank',
  ], { stdio: 'ignore' });

  try {
    await waitForChrome();
    const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
    const cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send('Page.enable');

    for (const shot of SHOTS) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.send('Page.navigate', { url: BASE + shot.url });
      await sleep(800);
      await cdp.evaluate(PAGE_HELPERS);
      for (const [action, arg] of shot.steps) {
        if (action === 'click') await cdp.evaluate(`__pg.click(${JSON.stringify(arg)})`);
        else await cdp.evaluate(`__pg.waitForText(${JSON.stringify(arg)})`);
        await sleep(300);
      }
      await sleep(600);   // let charts and transitions settle

      const height = await cdp.evaluate('Math.ceil(document.documentElement.scrollHeight)');
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height, deviceScaleFactor: 1, mobile: false });
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, shot.file), Buffer.from(data, 'base64'));
      console.log(`✔ ${shot.file} (${WIDTH}×${height})`);
    }
    cdp.ws.close();
  } finally {
    // Wait for Chrome to exit before removing its profile, and never let
    // cleanup hide the real error
    await new Promise((resolve) => {
      chrome.once('exit', resolve);
      chrome.kill();
    });
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // a leftover temp folder is harmless
    }
  }
}

main().catch((err) => {
  console.error(`✖ ${err.message}`);
  process.exit(1);
});
