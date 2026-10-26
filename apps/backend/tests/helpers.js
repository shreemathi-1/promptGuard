/**
 * Test helpers for node:test (no Jest, no supertest: nothing to install).
 *
 * stub(path, exports)  replaces a module before the code under test requires
 *                      it — the node:test equivalent of jest.mock(). Each test
 *                      file runs in its own process, so stubs never leak.
 * listen(app)          starts the Express app on a free port for fetch().
 */
const path = require('path');
const { mock } = require('node:test');

const ROOT = path.resolve(__dirname, '..');

/** @param {string} rel — path relative to apps/backend, e.g. 'src/config/db' */
function stub(rel, exports) {
  const file = require.resolve(path.join(ROOT, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
  return exports;
}

/** The real module (loaded once; mutate its exports before dependents load). */
function real(rel) {
  return require(path.join(ROOT, rel));
}

/** A mock function that resolves to value. */
function resolves(value) {
  return mock.fn(async () => value);
}

/** A stub for src/config/db that answers every query with no rows. */
function dbStub() {
  return stub('src/config/db', {
    query: mock.fn(async () => ({ rows: [], rowCount: 0 })),
    pool: { query: mock.fn(async () => ({ rows: [] })), connect: mock.fn() },
    testConnection: mock.fn(async () => {}),
  });
}

/** Starts app on an ephemeral port → { url, close } */
function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

async function post(base, route, body) {
  const res = await fetch(base + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function get(base, route) {
  const res = await fetch(base + route);
  return { status: res.status, body: await res.json() };
}

/** Arguments of the n-th call to a mock.fn */
function args(fn, n = 0) {
  return fn.mock.calls[n].arguments;
}

module.exports = { stub, real, resolves, dbStub, listen, post, get, args, mock };
