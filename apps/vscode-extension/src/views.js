const vscode = require('vscode');

/**
 * "PromptGuard Findings" tree in the Explorer, and the status bar item.
 */

const SEVERITY_ICON = {
  CRITICAL: new vscode.ThemeIcon('error', new vscode.ThemeColor('list.errorForeground')),
  HIGH: new vscode.ThemeIcon('error', new vscode.ThemeColor('list.errorForeground')),
  MEDIUM: new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground')),
  LOW: new vscode.ThemeIcon('info'),
};

class FindingsTree {
  /** @param {import('./findings').FindingsStore} store */
  constructor(store) {
    this.store = store;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
    this.subscription = store.onDidChange(() => this.emitter.fire());
  }

  getChildren(element) {
    if (!element) return this.store.files().map((entry) => ({ kind: 'file', entry }));
    if (element.kind === 'file') return element.entry.findings.map((finding) => ({ kind: 'finding', finding, uri: element.entry.uri }));
    return [];
  }

  getTreeItem(element) {
    if (element.kind === 'file') {
      const { uri, findings } = element.entry;
      const item = new vscode.TreeItem(this.store.relativePath(uri), vscode.TreeItemCollapsibleState.Expanded);
      item.resourceUri = uri;
      item.description = `${findings.length}`;
      item.tooltip = uri.fsPath;
      return item;
    }
    const f = element.finding;
    const item = new vscode.TreeItem(`${f.patternName || f.category}`, vscode.TreeItemCollapsibleState.None);
    item.description = `${f.preview} · line ${f.line}`;
    item.tooltip = new vscode.MarkdownString(
      `**${f.severity}** ${f.category}\n\n\`${f.preview}\`${typeof f.confidence === 'number' ? ` · ${Math.round(f.confidence * 100)}% confidence` : ''}${f.source ? ` · ${f.source}` : ''}`);
    item.iconPath = SEVERITY_ICON[f.severity] ?? SEVERITY_ICON.LOW;
    const pos = new vscode.Position(f.line - 1, f.column - 1);
    item.command = {
      command: 'vscode.open',
      title: 'Open',
      arguments: [element.uri, { selection: new vscode.Range(pos, pos) }],
    };
    return item;
  }

  dispose() {
    this.subscription.dispose();
    this.emitter.dispose();
  }
}

class StatusBar {
  /**
   * @param {import('./findings').FindingsStore} store
   * @param {import('./client').Client} client
   */
  constructor(store, client) {
    this.store = store;
    this.client = client;
    this.health = null;     // last /api/health result, or null
    this.error = null;      // last error message, or null
    this.lastScan = null;
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    this.item.command = 'promptguard.showStatus';
    this.item.name = 'PromptGuard';
    this.subscription = store.onDidChange(() => this.render());
    this.render();
    this.item.show();
  }

  async refreshHealth() {
    try {
      this.health = await this.client.health();
      this.error = null;
    } catch (err) {
      this.health = null;
      this.error = err.message;
    }
    this.render();
  }

  scanned(info) {
    this.lastScan = info;
    this.render();
  }

  failed(err) {
    this.error = err.message;
    this.render();
  }

  render() {
    const { total, high } = this.store.counts();
    const offline = Boolean(this.error);
    const aiDown = this.health && this.health.ml !== 'ok';

    let text = '$(shield) PromptGuard';
    if (offline) text = '$(debug-disconnect) PromptGuard';
    else if (high) text = `$(shield) ${high}`;
    else if (total) text = `$(shield) ${total}`;
    this.item.text = text;
    this.item.backgroundColor = offline || high
      ? new vscode.ThemeColor(high ? 'statusBarItem.errorBackground' : 'statusBarItem.warningBackground')
      : undefined;

    const lines = ['**PromptGuard**', ''];
    if (offline) lines.push(`$(debug-disconnect) ${this.error}`);
    else if (this.health) lines.push(`$(check) Backend ${this.client.apiUrl}`, aiDown ? '$(warning) AI service unavailable: regex rules only' : '$(sparkle) AI detection on');
    else lines.push('Checking backend…');
    lines.push('', total ? `${total} finding${total === 1 ? '' : 's'} (${high} high or critical)` : 'No findings');
    if (this.lastScan?.fellBack) lines.push(`$(warning) ${this.lastScan.fellBack} file(s) scanned with regex only`);
    const tooltip = new vscode.MarkdownString(lines.join('\n\n'), true);
    tooltip.isTrusted = false;
    this.item.tooltip = tooltip;
  }

  dispose() {
    this.subscription.dispose();
    this.item.dispose();
  }
}

module.exports = { FindingsTree, StatusBar };
