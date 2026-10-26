/**
 * Integration suite, executed inside VS Code's extension host by run.js.
 * VS Code calls run(); a rejected promise fails the run.
 */
const vscode = require('vscode');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Made-up key, written in two pieces so secret scanners don't flag the source
const KEY = 'AKIA' + 'Q7XR2MZP4KD8NW3T';
const WS = process.env.PROMPTGUARD_TEST_WORKSPACE;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, what, timeoutMs = 10_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
let api;

test('activates and registers its commands', async () => {
  const ext = vscode.extensions.getExtension('promptguard.promptguard');
  assert.ok(ext, 'extension found');
  api = await ext.activate();
  assert.ok(api.store && api.scanner, 'activate() returns the test API');
  const commands = await vscode.commands.getCommands(true);
  for (const id of ['promptguard.scanFile', 'promptguard.scanStaged', 'promptguard.copyMasked', 'promptguard.installHook', 'promptguard.moveToEnv']) {
    assert.ok(commands.includes(id), `${id} registered`);
  }
});

test('saving a file with a key shows a PromptGuard error in Problems', async () => {
  const uri = vscode.Uri.file(path.join(WS, 'config.js'));
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc);
  await editor.edit((b) => b.insert(new vscode.Position(1, 0), `export const AWS_ACCESS_KEY_ID = "${KEY}";\n`));
  await doc.save();

  const diags = await waitFor(() => {
    const d = vscode.languages.getDiagnostics(uri).filter((x) => x.source === 'PromptGuard');
    return d.length ? d : null;
  }, 'diagnostics after save');
  assert.strictEqual(diags[0].severity, vscode.DiagnosticSeverity.Error);
  assert.strictEqual(diags[0].range.start.line, 1);
  assert.strictEqual(doc.getText(diags[0].range), KEY, 'the squiggle covers exactly the key');
  assert.ok(!diags[0].message.includes(KEY), 'the message shows a masked preview, not the key');
});

test('offers Mask / Move to .env / Ignore quick fixes, and Mask edits the file', async () => {
  const uri = vscode.Uri.file(path.join(WS, 'config.js'));
  const diag = vscode.languages.getDiagnostics(uri).find((x) => x.source === 'PromptGuard');
  const actions = await vscode.commands.executeCommand('vscode.executeCodeActionProvider', uri, diag.range, vscode.CodeActionKind.QuickFix.value);
  const titles = actions.map((a) => a.title);
  for (const t of ['PromptGuard: Mask this API_KEY', 'PromptGuard: Move to .env', 'PromptGuard: Ignore on this line (false positive)']) {
    assert.ok(titles.includes(t), `"${t}" offered (got ${titles.join(' | ')})`);
  }

  const mask = actions.find((a) => a.title.startsWith('PromptGuard: Mask'));
  await vscode.workspace.applyEdit(mask.edit);
  const doc = await vscode.workspace.openTextDocument(uri);
  assert.ok(doc.getText().includes('"[API_KEY REDACTED]"'));
  assert.ok(!doc.getText().includes(KEY));
  await doc.save();
  await waitFor(() => vscode.languages.getDiagnostics(uri).every((x) => x.source !== 'PromptGuard'), 'diagnostics cleared after masking');
});

test('Scan Staged Files reads the git index and counts what the hook would block', async () => {
  fs.writeFileSync(path.join(WS, 'secrets.env'), `AWS_ACCESS_KEY_ID=${KEY}\n`);
  execFileSync('git', ['add', 'secrets.env'], { cwd: WS });
  const summary = await api.scanner.scanStaged([WS]);
  assert.strictEqual(summary.files, 1);
  assert.strictEqual(summary.blocking, 1);
  const uri = vscode.Uri.file(path.join(WS, 'secrets.env'));
  assert.ok(api.store.findingsFor(uri).length === 1, 'staged finding shown');
});

test('Install Pre-commit Hook writes a PromptGuard hook', async () => {
  await vscode.commands.executeCommand('promptguard.installHook');
  const hookFile = path.join(WS, '.git', 'hooks', 'pre-commit');
  await waitFor(() => fs.existsSync(hookFile), 'hook file');
  assert.ok(fs.readFileSync(hookFile, 'utf8').includes('promptguard-hook'));
});

async function run() {
  const failures = [];
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  ✔ ${t.name}`);
    } catch (err) {
      failures.push(t.name);
      console.log(`  ✖ ${t.name}\n    ${err.stack}`);
    }
  }
  console.log(`\n${tests.length - failures.length}/${tests.length} integration tests passed`);
  if (failures.length) throw new Error(`${failures.length} integration test(s) failed`);
}

module.exports = { run };
