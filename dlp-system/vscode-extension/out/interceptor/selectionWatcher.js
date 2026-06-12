"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SelectionWatcher = void 0;
const vscode = __importStar(require("vscode"));
/**
 * Selection Watcher — scans the active editor selection for sensitive data
 * and highlights violations inline.
 *
 * Fires on every selection change (debounced to avoid excessive scans).
 */
class SelectionWatcher {
    scanner;
    policyEngine;
    decorations;
    auditLogger;
    debounceTimer = null;
    DEBOUNCE_MS = 600;
    constructor(scanner, policyEngine, decorations, auditLogger) {
        this.scanner = scanner;
        this.policyEngine = policyEngine;
        this.decorations = decorations;
        this.auditLogger = auditLogger;
    }
    /**
     * Creates the VS Code event listener disposable.
     */
    register() {
        return vscode.window.onDidChangeTextEditorSelection((event) => this.onSelectionChange(event));
    }
    onSelectionChange(event) {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => this.scan(event.textEditor), this.DEBOUNCE_MS);
    }
    async scan(editor) {
        const selection = editor.selection;
        // Only scan non-empty selections
        if (selection.isEmpty) {
            this.decorations.clearAll(editor);
            return;
        }
        const selectedText = editor.document.getText(selection);
        if (selectedText.trim().length < 4)
            return;
        const scanResult = await this.scanner.scan(selectedText);
        if (scanResult.detectionCount === 0) {
            this.decorations.clearAll(editor);
            return;
        }
        const decision = this.policyEngine.evaluate(scanResult);
        if (decision.action === 'ALLOW') {
            this.decorations.clearAll(editor);
            return;
        }
        // Apply inline decorations for each detection
        this.decorations.applyDetections(editor, selection, scanResult.detections);
    }
    /**
     * Scans the ENTIRE current document (used by "Scan Current File" command).
     */
    async scanFullDocument(editor) {
        const text = editor.document.getText();
        const scanResult = await this.scanner.scan(text);
        if (scanResult.detectionCount === 0) {
            this.decorations.clearAll(editor);
            vscode.window.showInformationMessage('DLP Guardian: No sensitive data found in this file.');
            return;
        }
        // Use a full-document selection as anchor for decorations
        const fullRange = new vscode.Selection(editor.document.positionAt(0), editor.document.positionAt(text.length));
        this.decorations.applyDetections(editor, fullRange, scanResult.detections);
        await this.auditLogger.log({
            action: 'WARN',
            detections: scanResult.detections,
            promptPreview: `[File: ${editor.document.fileName}]`,
            source: 'file-scan',
        });
        const categories = [...new Set(scanResult.detections.map(d => d.category))].join(', ');
        vscode.window.showWarningMessage(`DLP Guardian: ${scanResult.detectionCount} sensitive item(s) found [${categories}].`, 'Show Details').then(choice => {
            if (choice === 'Show Details') {
                this.showDetectionReport(scanResult.detections);
            }
        });
    }
    showDetectionReport(detections) {
        const lines = detections.map(d => `  Line ${d.line + 1}, Col ${d.column}: [${d.severity}] ${d.ruleName} → ${d.masked}`);
        const report = `DLP Detection Report:\n${lines.join('\n')}`;
        vscode.window.showInformationMessage(report, { modal: true });
    }
}
exports.SelectionWatcher = SelectionWatcher;
//# sourceMappingURL=selectionWatcher.js.map