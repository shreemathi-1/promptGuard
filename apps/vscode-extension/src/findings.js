const vscode = require('vscode');
const path = require('path');
const { report } = require('./cliBridge');

/**
 * Holds the latest findings per file and publishes them as VS Code
 * diagnostics (Problems panel + squiggles) and to listeners (tree view,
 * status bar).
 *
 * Findings arrive from the backend's batch endpoint: line/column, severity,
 * category, masked preview, start/end offsets. The CLI's evaluate() applies
 * inline "promptguard:ignore" comments and the documented-test-value allowlist,
 * so the editor and the pre-commit hook always agree.
 */

const SOURCE = 'PromptGuard';
const RANK = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

function toSeverity(severity) {
  switch (severity) {
    case 'CRITICAL':
    case 'HIGH':
      return vscode.DiagnosticSeverity.Error;
    case 'MEDIUM':
      return vscode.DiagnosticSeverity.Warning;
    default:
      return vscode.DiagnosticSeverity.Information;
  }
}

/** offset → Position, via the start offset of each line */
function positionAt(lineStarts, offset) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return new vscode.Position(lo, offset - lineStarts[lo]);
}

function lineStartsOf(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function describe(f) {
  const confidence = typeof f.confidence === 'number' ? ` (${Math.round(f.confidence * 100)}% confidence)` : '';
  return `${f.patternName || f.category}: ${f.preview}${confidence}`;
}

class FindingsStore {
  constructor() {
    this.collection = vscode.languages.createDiagnosticCollection('promptguard');
    /** @type {Map<string, { uri: vscode.Uri, findings: object[] }>} */
    this.byUri = new Map();
    this.emitter = new vscode.EventEmitter();
    this.onDidChange = this.emitter.event;
  }

  /**
   * Replaces findings for the given files.
   *
   * @param {{ uri: vscode.Uri, content: string, result: object }[]} entries
   *        result = one element of the batch response's files[]
   * @param {string} minimumSeverity
   */
  set(entries, minimumSeverity = 'LOW') {
    for (const { uri, content, result } of entries) {
      const verdict = report.evaluate([result], [{ path: result.path, content }], 'HIGH');
      const findings = verdict.files[0].findings.filter((f) => (RANK[f.severity] ?? 0) >= RANK[minimumSeverity]);
      if (findings.length === 0) {
        this.byUri.delete(uri.toString());
        this.collection.delete(uri);
        continue;
      }
      this.byUri.set(uri.toString(), { uri, findings });
      const starts = lineStartsOf(content);
      this.collection.set(uri, findings.map((f) => {
        const range = new vscode.Range(positionAt(starts, f.start), positionAt(starts, f.end));
        const d = new vscode.Diagnostic(range, describe(f), toSeverity(f.severity));
        d.source = SOURCE;
        d.code = f.category;
        // Kept for the quick fixes
        d.promptguard = f;
        return d;
      }));
    }
    this.emitter.fire();
  }

  clear(uri) {
    if (uri) {
      this.byUri.delete(uri.toString());
      this.collection.delete(uri);
    } else {
      this.byUri.clear();
      this.collection.clear();
    }
    this.emitter.fire();
  }

  findingsFor(uri) {
    return this.byUri.get(uri.toString())?.findings ?? [];
  }

  /** The finding a diagnostic was made from (diagnostics lose custom fields in transit). */
  findingAt(uri, range) {
    return this.findingsFor(uri).find((f) => f.line - 1 === range.start.line && f.column - 1 === range.start.character);
  }

  /** Files with findings, most severe first. */
  files() {
    const top = (fs) => Math.max(...fs.map((f) => RANK[f.severity] ?? 0));
    return [...this.byUri.values()].sort((a, b) => top(b.findings) - top(a.findings)
      || a.uri.fsPath.localeCompare(b.uri.fsPath));
  }

  counts() {
    const all = [...this.byUri.values()].flatMap((e) => e.findings);
    return {
      total: all.length,
      high: all.filter((f) => RANK[f.severity] >= RANK.HIGH).length,
      files: this.byUri.size,
    };
  }

  relativePath(uri) {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    return folder ? path.relative(folder.uri.fsPath, uri.fsPath) : uri.fsPath;
  }

  dispose() {
    this.collection.dispose();
    this.emitter.dispose();
  }
}

module.exports = { FindingsStore, toSeverity, describe, positionAt, lineStartsOf, SOURCE, RANK };
