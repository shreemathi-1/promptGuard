const vscode = require('vscode');
const path = require('path');
const { hook } = require('./cliBridge');
const { BackendUnreachableError, BackendError } = require('./client');
const { moveToEnv, MOVE_TO_ENV } = require('./codeActions');
const fixes = require('./fixes');

/**
 * Command implementations. Every command goes through run(), so a missing
 * backend always produces the same actionable message.
 */

const MAPPING_KEY = 'promptguard.rewriteMappingId';

function config() {
  return vscode.workspace.getConfiguration('promptguard');
}

function pluralise(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Selection text, or the whole document when nothing is selected. */
function selectionOrDocument(editor) {
  if (!editor) return null;
  const sel = editor.selection;
  if (!sel.isEmpty) return { text: editor.document.getText(sel), range: sel, whole: false };
  const doc = editor.document;
  return { text: doc.getText(), range: new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), whole: true };
}

function requireEditor() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) vscode.window.showWarningMessage('PromptGuard: open a file first.');
  return editor;
}

async function reportError(err, retry) {
  if (err instanceof BackendUnreachableError) {
    const choice = await vscode.window.showErrorMessage(
      `${err.message}. Start it with "npm run dev:backend", or change promptguard.apiUrl.`, 'Open Settings', 'Retry');
    if (choice === 'Open Settings') vscode.commands.executeCommand('workbench.action.openSettings', 'promptguard.apiUrl');
    if (choice === 'Retry' && retry) retry();
    return;
  }
  const message = err instanceof BackendError ? err.message : (err?.message ?? String(err));
  vscode.window.showErrorMessage(`PromptGuard: ${message}`);
}

/**
 * Git repository roots: from the built-in git extension when available,
 * otherwise the workspace folders.
 */
async function gitRoots() {
  try {
    const gitExt = vscode.extensions.getExtension('vscode.git');
    if (gitExt) {
      const git = (gitExt.isActive ? gitExt.exports : await gitExt.activate()).getAPI(1);
      const roots = git.repositories.map((r) => r.rootUri.fsPath);
      if (roots.length) return roots;
    }
  } catch {
    // fall through
  }
  return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
}

/**
 * @param {vscode.ExtensionContext} context
 * @param {{ client, store, scanner, statusBar }} deps
 */
function registerCommands(context, { client, store, scanner, statusBar }) {
  const register = (id, fn) => {
    const run = async (...args) => {
      try {
        return await fn(...args);
      } catch (err) {
        statusBar.failed(err);
        return reportError(err, () => run(...args));
      }
    };
    context.subscriptions.push(vscode.commands.registerCommand(id, run));
  };

  register('promptguard.scanFile', async () => {
    const editor = requireEditor();
    if (!editor) return;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'PromptGuard: scanning…' },
      () => scanner.scanDocuments([editor.document]));
    statusBar.refreshHealth();
    const n = store.findingsFor(editor.document.uri).length;
    vscode.window.setStatusBarMessage(n ? `PromptGuard: ${pluralise(n, 'finding')}` : 'PromptGuard: no findings', 4000);
  });

  register('promptguard.scanSelection', async () => {
    const editor = requireEditor();
    const sel = selectionOrDocument(editor);
    if (!sel) return;
    const result = await client.scan(sel.text, config().get('detectionMode'));
    if (result.injection?.isInjection) {
      vscode.window.showWarningMessage(
        `PromptGuard: this text looks like a prompt-injection attempt (${Math.round(result.injection.score * 100)}%).`);
    }
    if (result.detectionCount === 0) {
      vscode.window.showInformationMessage('PromptGuard: no sensitive data found.');
      return;
    }
    await vscode.window.showQuickPick(result.detections.map((d) => ({
      label: `${d.patternName}`,
      description: fixes.maskPreview(d.match),
      detail: `${d.severity} · ${d.category}${d.source ? ` · ${d.source}` : ''}${typeof d.confidence === 'number' ? ` · ${Math.round(d.confidence * 100)}%` : ''}`,
    })), { title: `PromptGuard: ${pluralise(result.detectionCount, 'finding')} in the selection`, canPickMany: false });
  });

  register('promptguard.maskSelection', async () => {
    const editor = requireEditor();
    if (!editor || editor.selection.isEmpty) return;
    const styles = ['REDACT', 'PARTIAL', 'TOKENIZE'];
    const preferred = config().get('maskStyle');
    const pick = await vscode.window.showQuickPick(
      styles.map((s) => ({ label: s, description: s === preferred ? 'default' : '' })),
      { title: 'PromptGuard: mask style' });
    if (!pick) return;
    const result = await client.mask(editor.document.getText(editor.selection), pick.label, config().get('detectionMode'));
    if (result.maskedCount === 0) {
      vscode.window.showInformationMessage('PromptGuard: nothing to mask in the selection.');
      return;
    }
    await editor.edit((b) => b.replace(editor.selection, result.maskedText));
    vscode.window.showInformationMessage(`PromptGuard: masked ${pluralise(result.maskedCount, 'value')}.`);
  });

  register('promptguard.copyMasked', async () => {
    const sel = selectionOrDocument(requireEditor());
    if (!sel || !sel.text.trim()) return;
    const result = await client.mask(sel.text, config().get('maskStyle'), config().get('detectionMode'));
    await vscode.env.clipboard.writeText(result.maskedText);
    const what = sel.whole ? 'file' : 'selection';
    const injection = result.injection?.isInjection ? ' ⚠ It also looks like a prompt-injection attempt.' : '';
    vscode.window.showInformationMessage(result.maskedCount
      ? `PromptGuard: copied the ${what} with ${pluralise(result.maskedCount, 'value')} masked.${injection}`
      : `PromptGuard: copied the ${what}; nothing needed masking.${injection}`);
  });

  register('promptguard.rewriteSelection', async () => {
    const sel = selectionOrDocument(requireEditor());
    if (!sel || !sel.text.trim()) return;
    const mappingId = context.workspaceState.get(MAPPING_KEY);
    const result = await client.rewrite(sel.text, { mode: config().get('detectionMode'), mappingId });
    await context.workspaceState.update(MAPPING_KEY, result.mappingId);
    await vscode.env.clipboard.writeText(result.rewrittenText);
    const choice = await vscode.window.showInformationMessage(
      `PromptGuard: copied a rewritten prompt with ${pluralise(result.replacements.length, 'value')} swapped for realistic fakes. ` +
      'Paste it into your chatbot, then copy its reply and run "Restore Chatbot Reply".', 'Restore Reply Now');
    if (choice) vscode.commands.executeCommand('promptguard.restoreReply');
  });

  register('promptguard.restoreReply', async () => {
    const mappingId = context.workspaceState.get(MAPPING_KEY);
    if (!mappingId) {
      vscode.window.showWarningMessage('PromptGuard: run "Smart Rewrite Selection" first.');
      return;
    }
    const editor = vscode.window.activeTextEditor;
    const text = editor && !editor.selection.isEmpty
      ? editor.document.getText(editor.selection)
      : await vscode.env.clipboard.readText();
    if (!text.trim()) {
      vscode.window.showWarningMessage('PromptGuard: copy the chatbot reply (or select it) first.');
      return;
    }
    const result = await client.restore(mappingId, text);
    const doc = await vscode.workspace.openTextDocument({ content: result.text, language: 'markdown' });
    await vscode.window.showTextDocument(doc, { preview: false });
    vscode.window.showInformationMessage(`PromptGuard: restored ${pluralise(result.restoredCount, 'value')} in the reply.`);
  });

  register('promptguard.scanWorkspace', async () => {
    if (!vscode.workspace.workspaceFolders?.length) {
      vscode.window.showWarningMessage('PromptGuard: open a folder first.');
      return;
    }
    const summary = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'PromptGuard', cancellable: true },
      (progress, token) => scanner.scanWorkspace(progress, token));
    statusBar.refreshHealth();
    const { high } = store.counts();
    const msg = `PromptGuard: ${pluralise(summary.findings, 'finding')} in ${pluralise(summary.files, 'file')}` +
      (high ? ` (${high} high or critical)` : '') + (summary.skipped ? `, ${summary.skipped} skipped` : '') + '.';
    const choice = await (summary.findings ? vscode.window.showWarningMessage(msg, 'Show Findings') : vscode.window.showInformationMessage(msg));
    if (choice) vscode.commands.executeCommand('promptguard.findings.focus');
  });

  register('promptguard.scanStaged', async () => {
    const roots = await gitRoots();
    if (!roots.length) {
      vscode.window.showWarningMessage('PromptGuard: no git repository found.');
      return;
    }
    const summary = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'PromptGuard', cancellable: true },
      (progress, token) => scanner.scanStaged(roots, progress, token));
    if (summary.files === 0) {
      vscode.window.showInformationMessage('PromptGuard: no staged files to scan.');
      return;
    }
    const failOn = config().get('hookFailOn');
    if (summary.blocking) {
      const choice = await vscode.window.showErrorMessage(
        `PromptGuard: ${pluralise(summary.blocking, 'finding')} at or above ${failOn} in staged files — the pre-commit hook would block this commit.`,
        'Show Findings');
      if (choice) vscode.commands.executeCommand('promptguard.findings.focus');
    } else {
      vscode.window.showInformationMessage(
        `PromptGuard: staged files are clear at ${failOn}` + (summary.findings ? ` (${pluralise(summary.findings, 'lower-severity finding')}).` : '.'));
    }
  });

  register('promptguard.installHook', async () => {
    const roots = await gitRoots();
    if (!roots.length) {
      vscode.window.showWarningMessage('PromptGuard: no git repository found.');
      return;
    }
    const root = roots.length === 1 ? roots[0] : (await vscode.window.showQuickPick(roots, { title: 'Install the hook in which repository?' }));
    if (!root) return;
    const opts = { cwd: root, failOn: config().get('hookFailOn'), mode: config().get('detectionMode') || undefined, api: config().get('apiUrl') };
    let result;
    try {
      result = hook.install(opts);
    } catch (err) {
      if (!/already exists/.test(err.message)) throw err;
      const choice = await vscode.window.showWarningMessage(
        `${path.basename(root)} already has a pre-commit hook that PromptGuard didn't install. Replace it? (It will be backed up and restored on uninstall.)`,
        { modal: true }, 'Replace');
      if (!choice) return;
      result = hook.install({ ...opts, force: true });
    }
    vscode.window.showInformationMessage(
      `PromptGuard: pre-commit hook installed in ${path.basename(root)}. Commits with findings at or above ${opts.failOn} will be blocked ` +
      '(git commit --no-verify skips it). Re-run this command after updating the extension.' +
      (result.backedUp ? ' Your previous hook was backed up.' : ''));
  });

  register('promptguard.uninstallHook', async () => {
    const roots = await gitRoots();
    const results = roots.map((cwd) => ({ cwd, ...hook.uninstall({ cwd }) }));
    const removed = results.filter((r) => r.removed);
    vscode.window.showInformationMessage(removed.length
      ? `PromptGuard: removed the pre-commit hook from ${removed.map((r) => path.basename(r.cwd)).join(', ')}.`
      : 'PromptGuard: no PromptGuard hook was installed.');
  });

  register('promptguard.generateRule', async () => {
    const editor = requireEditor();
    if (!editor || editor.selection.isEmpty) {
      vscode.window.showWarningMessage('PromptGuard: select an example value first.');
      return;
    }
    const example = editor.document.getText(editor.selection).trim();
    const description = await vscode.window.showInputBox({
      title: 'PromptGuard: Generate rule',
      prompt: `What kind of data is "${example.slice(0, 40)}"?`,
      placeHolder: 'e.g. Internal employee IDs: EMP- followed by 6 digits',
      validateInput: (v) => (v.trim().length >= 3 ? null : 'Describe it in a few words'),
    });
    if (!description) return;
    const more = await vscode.window.showInputBox({
      title: 'PromptGuard: Generate rule (optional)',
      prompt: 'More examples that should match, comma-separated (Enter to skip)',
    });
    if (more === undefined) return;
    const examples = [example, ...more.split(',').map((s) => s.trim()).filter(Boolean)];

    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'PromptGuard: generating a rule with the local LLM…' },
      () => client.generateRule({ description, examples }));
    const passed = result.tests.filter((t) => t.passed).length;
    const pick = await vscode.window.showQuickPick([
      { label: '$(save) Save rule', id: 'save', description: result.rule.pattern, detail: `${result.rule.name} · ${result.rule.category} · ${result.rule.severity} · ${passed}/${result.tests.length} tests passed` },
      { label: '$(copy) Copy pattern', id: 'copy', description: result.rule.pattern },
    ], { title: result.verified ? 'PromptGuard: rule verified' : 'PromptGuard: rule did not pass every test — review it' });
    if (!pick) return;
    if (pick.id === 'copy') {
      await vscode.env.clipboard.writeText(result.rule.pattern);
      return;
    }
    const saved = await client.createRule({
      name: result.rule.name, pattern: result.rule.pattern, category: result.rule.category,
      severity: result.rule.severity, description: result.rule.explanation || description, source: 'AI_GENERATED',
    });
    vscode.window.showInformationMessage(`PromptGuard: saved rule "${saved.name}". It applies to scans immediately.`);
  });

  register(MOVE_TO_ENV, async (uri, range, finding) => {
    if (await moveToEnv(uri, range, finding)) {
      const doc = await vscode.workspace.openTextDocument(uri);
      await doc.save();
      await scanner.scanDocuments([doc]);
    }
  });

  register('promptguard.clearFindings', () => store.clear());

  register('promptguard.showStatus', async () => {
    await statusBar.refreshHealth();
    const pick = await vscode.window.showQuickPick([
      { label: '$(search) Scan Workspace', command: 'promptguard.scanWorkspace' },
      { label: '$(git-commit) Scan Staged Files', command: 'promptguard.scanStaged' },
      { label: '$(list-tree) Show Findings', command: 'promptguard.findings.focus' },
      { label: '$(shield) Install Pre-commit Hook', command: 'promptguard.installHook' },
      { label: '$(gear) Settings', command: 'workbench.action.openSettings', args: ['promptguard'] },
    ], { title: statusBar.error ? `PromptGuard: ${statusBar.error}` : `PromptGuard: connected to ${client.apiUrl}` });
    if (pick) vscode.commands.executeCommand(pick.command, ...(pick.args ?? []));
  });
}

module.exports = { registerCommands, reportError, gitRoots };
