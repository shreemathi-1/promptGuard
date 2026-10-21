const vscode = require('vscode');
const fixes = require('./fixes');
const { SOURCE } = require('./findings');

/**
 * Quick fixes on PromptGuard problems (lightbulb / Cmd+.):
 *   - Mask this value             replace it with [CATEGORY REDACTED] (or a partial mask)
 *   - Move to .env                put the value in .env and read it from the environment
 *   - Ignore on this line         add a "promptguard:ignore" comment
 */

const MOVE_TO_ENV = 'promptguard.moveToEnv';

class QuickFixProvider {
  /** @param {import('./findings').FindingsStore} store */
  constructor(store) {
    this.store = store;
  }

  provideCodeActions(document, _range, context) {
    const actions = [];
    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source !== SOURCE) continue;
      const finding = this.store.findingAt(document.uri, diagnostic.range) ?? { category: String(diagnostic.code ?? 'SECRET') };
      const value = document.getText(diagnostic.range);

      // Mask
      const style = vscode.workspace.getConfiguration('promptguard').get('maskStyle');
      const mask = new vscode.CodeAction(`PromptGuard: Mask this ${finding.category}`, vscode.CodeActionKind.QuickFix);
      mask.edit = new vscode.WorkspaceEdit();
      mask.edit.replace(document.uri, diagnostic.range, fixes.maskValue(value, finding.category, style));
      mask.diagnostics = [diagnostic];
      actions.push(mask);

      // Move to .env (only where we know how the language reads env vars)
      if (fixes.envAccessor(document.languageId, 'X') && diagnostic.range.isSingleLine) {
        const move = new vscode.CodeAction('PromptGuard: Move to .env', vscode.CodeActionKind.QuickFix);
        move.command = { command: MOVE_TO_ENV, title: 'Move to .env', arguments: [document.uri, diagnostic.range, finding] };
        move.diagnostics = [diagnostic];
        move.isPreferred = finding.category === 'API_KEY';
        actions.push(move);
      }

      // Ignore
      const line = document.lineAt(diagnostic.range.start.line);
      const ignored = fixes.withIgnoreComment(line.text, document.languageId);
      if (ignored) {
        const ignore = new vscode.CodeAction('PromptGuard: Ignore on this line (false positive)', vscode.CodeActionKind.QuickFix);
        ignore.edit = new vscode.WorkspaceEdit();
        ignore.edit.replace(document.uri, line.range, ignored);
        ignore.diagnostics = [diagnostic];
        actions.push(ignore);
      }
    }
    return actions;
  }
}

QuickFixProvider.metadata = { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] };

async function readText(uri) {
  try {
    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Moves the value at range into <workspace>/.env and replaces the literal with
 * the language's env lookup. Makes sure .env is git-ignored.
 *
 * @returns {Promise<boolean>} whether the move happened
 */
async function moveToEnv(uri, range, finding = {}) {
  const document = await vscode.workspace.openTextDocument(uri);
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) {
    vscode.window.showWarningMessage('PromptGuard: Move to .env needs the file to be inside a workspace folder.');
    return false;
  }

  const value = document.getText(range);
  const lineText = document.lineAt(range.start.line).text;
  const name = await vscode.window.showInputBox({
    title: 'PromptGuard: Move to .env',
    prompt: 'Environment variable name',
    value: fixes.envVarName({ ...finding, column: range.start.character + 1 }, lineText),
    validateInput: (v) => (fixes.isValidEnvName(v) ? null : 'Use UPPER_SNAKE_CASE letters, digits and underscores'),
  });
  if (!name) return false;

  const envUri = vscode.Uri.joinPath(folder.uri, '.env');
  const env = (await readText(envUri)) ?? '';
  const existing = env.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  if (existing && existing !== fixes.envLine(name, value)) {
    const choice = await vscode.window.showWarningMessage(
      `${name} is already set in .env with a different value.`, { modal: true }, 'Use the existing value');
    if (!choice) return false;
  }

  // 1. .env
  if (!existing) {
    const sep = env && !env.endsWith('\n') ? '\n' : '';
    await vscode.workspace.fs.writeFile(envUri, Buffer.from(`${env}${sep}${fixes.envLine(name, value)}\n`));
  }

  // 2. .gitignore — otherwise the secret just moves into another committed file
  const gitignoreUri = vscode.Uri.joinPath(folder.uri, '.gitignore');
  const gitignore = (await readText(gitignoreUri)) ?? '';
  let ignoredNow = false;
  if (!fixes.gitignoreCoversEnv(gitignore)) {
    const sep = gitignore && !gitignore.endsWith('\n') ? '\n' : '';
    await vscode.workspace.fs.writeFile(gitignoreUri, Buffer.from(`${gitignore}${sep}.env\n`));
    ignoredNow = true;
  }

  // 3. the source: replace the literal (quotes included) with the env lookup
  const q = fixes.quotedRange(lineText, range.start.character, range.end.character);
  const literal = new vscode.Range(range.start.line, q.start, range.start.line, q.end);
  const accessor = fixes.envAccessor(document.languageId, name);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, literal, accessor);
  if (document.languageId === 'python' && !/^\s*import os\b|^\s*from os import/m.test(document.getText())) {
    edit.insert(uri, new vscode.Position(0, 0), 'import os\n');
  }
  await vscode.workspace.applyEdit(edit);

  const notes = [`Moved to .env as ${name}.`];
  if (ignoredNow) notes.push('Added .env to .gitignore.');
  if (document.languageId.startsWith('javascript') || document.languageId.startsWith('typescript')) {
    notes.push('Make sure your app loads .env (e.g. dotenv).');
  }
  notes.push('If this value was ever committed, rotate it.');
  vscode.window.showInformationMessage(`PromptGuard: ${notes.join(' ')}`);
  return true;
}

module.exports = { QuickFixProvider, moveToEnv, MOVE_TO_ENV };
