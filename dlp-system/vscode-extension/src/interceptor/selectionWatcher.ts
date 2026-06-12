import * as vscode from 'vscode';
import { Scanner }      from '../scanner';
import { PolicyEngine } from '../policies/policyEngine';
import { Decorations }  from '../ui/decorations';
import { AuditLogger }  from '../audit/auditLogger';

/**
 * Selection Watcher — scans the active editor selection for sensitive data
 * and highlights violations inline.
 *
 * Fires on every selection change (debounced to avoid excessive scans).
 */
export class SelectionWatcher {
  private debounceTimer: NodeJS.Timeout | null = null;
  private readonly DEBOUNCE_MS = 600;

  constructor(
    private scanner:      Scanner,
    private policyEngine: PolicyEngine,
    private decorations:  Decorations,
    private auditLogger:  AuditLogger
  ) {}

  /**
   * Creates the VS Code event listener disposable.
   */
  register(): vscode.Disposable {
    return vscode.window.onDidChangeTextEditorSelection(
      (event) => this.onSelectionChange(event)
    );
  }

  private onSelectionChange(event: vscode.TextEditorSelectionChangeEvent): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(
      () => this.scan(event.textEditor),
      this.DEBOUNCE_MS
    );
  }

  private async scan(editor: vscode.TextEditor): Promise<void> {
    const selection = editor.selection;

    // Only scan non-empty selections
    if (selection.isEmpty) {
      this.decorations.clearAll(editor);
      return;
    }

    const selectedText = editor.document.getText(selection);
    if (selectedText.trim().length < 4) return;

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
  async scanFullDocument(editor: vscode.TextEditor): Promise<void> {
    const text       = editor.document.getText();
    const scanResult = await this.scanner.scan(text);

    if (scanResult.detectionCount === 0) {
      this.decorations.clearAll(editor);
      vscode.window.showInformationMessage('DLP Guardian: No sensitive data found in this file.');
      return;
    }

    // Use a full-document selection as anchor for decorations
    const fullRange = new vscode.Selection(
      editor.document.positionAt(0),
      editor.document.positionAt(text.length)
    );

    this.decorations.applyDetections(editor, fullRange, scanResult.detections);

    await this.auditLogger.log({
      action:        'WARN',
      detections:    scanResult.detections,
      promptPreview: `[File: ${editor.document.fileName}]`,
      source:        'file-scan',
    });

    const categories = [...new Set(scanResult.detections.map(d => d.category))].join(', ');
    vscode.window.showWarningMessage(
      `DLP Guardian: ${scanResult.detectionCount} sensitive item(s) found [${categories}].`,
      'Show Details'
    ).then(choice => {
      if (choice === 'Show Details') {
        this.showDetectionReport(scanResult.detections);
      }
    });
  }

  private showDetectionReport(detections: import('../scanner').Detection[]): void {
    const lines = detections.map(
      d => `  Line ${d.line + 1}, Col ${d.column}: [${d.severity}] ${d.ruleName} → ${d.masked}`
    );
    const report = `DLP Detection Report:\n${lines.join('\n')}`;
    vscode.window.showInformationMessage(report, { modal: true });
  }
}