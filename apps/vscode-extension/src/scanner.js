const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { files: cliFiles, ignore, api } = require('./cliBridge');

/**
 * Runs scans through the backend's batch endpoint — the same request the CLI
 * and the pre-commit hook make — and stores the results in the FindingsStore.
 */

const SAVE_DEBOUNCE_MS = 400;
const RANK = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
const MAX_CHARS = 1_000_000;

function safeRealpath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

function config() {
  return vscode.workspace.getConfiguration('promptguard');
}

class Scanner {
  /**
   * @param {import('./findings').FindingsStore} store
   * @param {(state: object) => void} onScanned — status bar hook
   */
  constructor(store, onScanned = () => {}) {
    this.store = store;
    this.onScanned = onScanned;
    this.timers = new Map();
  }

  get apiUrl() {
    return config().get('apiUrl');
  }

  get mode() {
    return config().get('detectionMode') || undefined;
  }

  /** Path sent to the backend (shows up in its audit log): workspace-relative. */
  requestPath(uri) {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    return folder ? path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join('/') : path.basename(uri.fsPath || uri.path);
  }

  isExcluded(uri) {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) return false;
    const matcher = ignore.createMatcher({ root: folder.uri.fsPath });
    return matcher(path.relative(folder.uri.fsPath, uri.fsPath));
  }

  /**
   * Scans {uri, content} entries in batches. Returns the number of findings stored.
   * @param {{ uri: vscode.Uri, content: string }[]} entries
   * @param {vscode.CancellationToken} [token]
   */
  async scanEntries(entries, token) {
    const nonEmpty = entries.filter((e) => e.content.trim() && e.content.length <= MAX_CHARS);
    if (nonEmpty.length === 0) return 0;

    const byPath = new Map();
    const files = nonEmpty.map((e) => {
      const p = this.requestPath(e.uri);
      byPath.set(p, e);
      return { path: p, content: e.content };
    });

    let fellBack = 0;
    for (const batch of api.chunk(files)) {
      if (token?.isCancellationRequested) break;
      const result = await api.scanFiles(this.apiUrl, batch, { mode: this.mode });
      fellBack += result.summary.filesFellBack;
      this.store.set(
        result.files.map((r) => ({ uri: byPath.get(r.path).uri, content: byPath.get(r.path).content, result: r })),
        config().get('minimumSeverity'),
      );
    }
    this.onScanned({ at: new Date(), fellBack });
    return this.store.counts().total;
  }

  /** Scans open documents (unsaved changes included). */
  scanDocuments(documents, token) {
    return this.scanEntries(documents.map((d) => ({ uri: d.uri, content: d.getText() })), token);
  }

  /** Debounced scan-on-save. Errors are reported through onError (status bar), not popups. */
  scheduleOnSave(document, onError) {
    if (!config().get('scanOnSave')) return;
    if (document.uri.scheme !== 'file' || this.isExcluded(document.uri)) return;
    const key = document.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      this.scanDocuments([document]).catch(onError);
    }, SAVE_DEBOUNCE_MS));
  }

  /** All files in every workspace folder, honouring .promptguardignore and the defaults. */
  async scanWorkspace(progress, token) {
    const entries = [];
    let skipped = 0;
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      progress?.report({ message: `Reading ${folder.name}…` });
      const collected = cliFiles.collectPaths(['.'], { cwd: folder.uri.fsPath });
      skipped += collected.skipped.length;
      for (const f of collected.files) {
        entries.push({ uri: vscode.Uri.joinPath(folder.uri, f.path), content: f.content });
      }
    }
    progress?.report({ message: `Scanning ${entries.length} files…` });
    this.store.clear();
    const total = await this.scanEntries(entries, token);
    return { files: entries.length, findings: total, skipped };
  }

  /**
   * The staged (index) version of each changed file in every git repository —
   * exactly what the next commit contains, like the pre-commit hook.
   */
  async scanStaged(roots, progress, token) {
    const entries = [];
    for (const root of roots) {
      progress?.report({ message: `Reading staged files in ${path.basename(root)}…` });
      const collected = cliFiles.collectStaged({ cwd: root });
      // git reports the resolved path (/private/var/… on macOS, or past any
      // symlink); keep the path VS Code knows the files by, or the squiggles
      // would land on a URI the editor never opens
      const base = safeRealpath(root) === collected.root ? root : collected.root;
      for (const f of collected.files) {
        entries.push({ uri: vscode.Uri.file(path.join(base, f.path)), content: f.content });
      }
    }
    if (entries.length === 0) return { files: 0, findings: 0, blocking: 0 };
    progress?.report({ message: `Scanning ${entries.length} staged files…` });
    for (const e of entries) this.store.clear(e.uri);
    await this.scanEntries(entries, token);

    // Count only the staged files, and what the hook would block on
    const failOn = RANK[config().get('hookFailOn')] ?? RANK.HIGH;
    const findings = entries.flatMap((e) => this.store.findingsFor(e.uri));
    return {
      files: entries.length,
      findings: findings.length,
      blocking: findings.filter((f) => (RANK[f.severity] ?? 0) >= failOn).length,
    };
  }

  dispose() {
    for (const t of this.timers.values()) clearTimeout(t);
  }
}

module.exports = { Scanner };
