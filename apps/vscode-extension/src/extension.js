const vscode = require('vscode');
const { Client } = require('./client');
const { FindingsStore } = require('./findings');
const { Scanner } = require('./scanner');
const { QuickFixProvider } = require('./codeActions');
const { FindingsTree, StatusBar } = require('./views');
const { registerCommands } = require('./commands');
const { registerChat } = require('./chat');

/**
 * PromptGuard for VS Code.
 *
 * Every scan goes through the PromptGuard backend (promptguard.apiUrl), so
 * rules, AI detection and the audit log stay in one place, and results match
 * the CLI and the pre-commit hook exactly.
 */

const HEALTH_INTERVAL_MS = 60_000;

function activate(context) {
  const client = new Client(() => vscode.workspace.getConfiguration('promptguard').get('apiUrl'));
  const store = new FindingsStore();
  const statusBar = new StatusBar(store, client);
  const scanner = new Scanner(store, (info) => statusBar.scanned(info));
  const tree = new FindingsTree(store);

  context.subscriptions.push(
    store, statusBar, scanner, tree,
    vscode.window.registerTreeDataProvider('promptguard.findings', tree),
    vscode.languages.registerCodeActionsProvider(
      [{ scheme: 'file' }, { scheme: 'untitled' }], new QuickFixProvider(store), QuickFixProvider.metadata),
    vscode.workspace.onDidSaveTextDocument((doc) => scanner.scheduleOnSave(doc, (err) => statusBar.failed(err))),
    // Findings for a deleted file go away; edits keep them until the next save
    vscode.workspace.onDidDeleteFiles((e) => e.files.forEach((uri) => store.clear(uri))),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('promptguard.apiUrl')) statusBar.refreshHealth();
    }),
  );

  registerCommands(context, { client, store, scanner, statusBar });
  registerChat(context, client);

  statusBar.refreshHealth();
  const timer = setInterval(() => statusBar.refreshHealth(), HEALTH_INTERVAL_MS);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  // Exposed for the integration tests
  return { client, store, scanner, statusBar };
}

function deactivate() {}

module.exports = { activate, deactivate };
