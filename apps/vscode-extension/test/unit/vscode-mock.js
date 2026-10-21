/**
 * Just enough of the `vscode` API for unit tests. Installed by requiring this
 * file before any extension module: require('vscode') then resolves here.
 */
const Module = require('module');
const path = require('path');

class Position {
  constructor(line, character) { this.line = line; this.character = character; }
  isEqual(o) { return o.line === this.line && o.character === this.character; }
}

class Range {
  constructor(a, b, c, d) {
    if (a instanceof Position) { this.start = a; this.end = b; } else { this.start = new Position(a, b); this.end = new Position(c, d); }
  }
  get isSingleLine() { return this.start.line === this.end.line; }
}

class EventEmitter {
  constructor() { this.listeners = []; this.event = (fn) => { this.listeners.push(fn); return { dispose() {} }; }; }
  fire(v) { this.listeners.forEach((fn) => fn(v)); }
  dispose() {}
}

class WorkspaceEdit {
  constructor() { this.ops = []; }
  replace(uri, range, text) { this.ops.push({ op: 'replace', uri, range, text }); }
  insert(uri, position, text) { this.ops.push({ op: 'insert', uri, position, text }); }
}

const Uri = {
  file: (p) => ({ fsPath: p, path: p, scheme: 'file', toString: () => `file://${p}` }),
  joinPath: (base, ...parts) => Uri.file(path.join(base.fsPath, ...parts)),
};

const settings = {
  apiUrl: 'http://localhost:4000', detectionMode: '', scanOnSave: true, minimumSeverity: 'LOW',
  maskStyle: 'REDACT', hookFailOn: 'HIGH', 'chat.blockInjection': true,
};

const collections = [];

const vscode = {
  Position, Range, EventEmitter, WorkspaceEdit, Uri,
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  Diagnostic: class { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } },
  CodeAction: class { constructor(title, kind) { this.title = title; this.kind = kind; } },
  CodeActionKind: { QuickFix: 'quickfix' },
  ThemeIcon: class { constructor(id, color) { this.id = id; this.color = color; } },
  ThemeColor: class { constructor(id) { this.id = id; } },
  TreeItem: class { constructor(label, state) { this.label = label; this.collapsibleState = state; } },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  LanguageModelChatMessage: { User: (content) => ({ role: 'user', content }) },
  languages: {
    createDiagnosticCollection: () => {
      const map = new Map();
      const c = {
        set: (uri, d) => map.set(uri.toString(), d), delete: (uri) => map.delete(uri.toString()),
        clear: () => map.clear(), get: (uri) => map.get(uri.toString()), dispose() {}, map,
      };
      collections.push(c);
      return c;
    },
  },
  workspace: {
    workspaceFolders: [],
    getConfiguration: () => ({ get: (key) => settings[key] }),
    getWorkspaceFolder: (uri) => vscode.workspace.workspaceFolders.find((f) => uri.fsPath.startsWith(f.uri.fsPath)),
  },
  window: {},
  lm: { selectChatModels: async () => [] },
  _settings: settings,
  _collections: collections,
};

const original = Module._resolveFilename;
Module._resolveFilename = function resolve(request, ...rest) {
  if (request === 'vscode') return __filename;
  return original.call(this, request, ...rest);
};
require.cache[__filename] = { id: __filename, filename: __filename, loaded: true, exports: vscode };

module.exports = vscode;
