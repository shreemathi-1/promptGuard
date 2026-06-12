import * as vscode from 'vscode';
import { Scanner }      from '../scanner';
import { PolicyEngine } from '../policies/policyEngine';
import { AuditLogger }  from '../audit/auditLogger';
import { StatusBar }    from '../ui/statusBar';

/**
 * Clipboard Monitor — polls clipboard every N ms and warns on sensitive content.
 *
 * VS Code does not provide a clipboard change event, so we poll.
 * This is the standard approach used by all clipboard-monitoring extensions.
 */
export class ClipboardMonitor {
  private lastClipboard: string = '';
  private timer:         NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL_MS = 1500;

  constructor(
    private scanner:      Scanner,
    private policyEngine: PolicyEngine,
    private auditLogger:  AuditLogger,
    private statusBar:    StatusBar
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.check(), this.POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async check(): Promise<void> {
    try {
      const current = await vscode.env.clipboard.readText();
      if (!current || current === this.lastClipboard) return;

      this.lastClipboard = current;

      // Only scan if clipboard content is non-trivial
      if (current.trim().length < 8) return;

      const scanResult = await this.scanner.scan(current);
      if (scanResult.detectionCount === 0) return;

      const decision = this.policyEngine.evaluate(scanResult);
      if (decision.action === 'ALLOW') return;

      // Show a non-blocking notification
      const categories = [...new Set(scanResult.detections.map(d => d.category))].join(', ');
      const message    = `DLP Guardian: Clipboard contains sensitive data [${categories}].`;

      const choice = await vscode.window.showWarningMessage(
        message,
        { modal: false },
        'Clear Clipboard',
        'View Details',
        'Dismiss'
      );

      if (choice === 'Clear Clipboard') {
        await vscode.env.clipboard.writeText('');
        this.lastClipboard = '';
        vscode.window.showInformationMessage('DLP Guardian: Clipboard cleared.');
      }

      if (choice === 'View Details') {
        const detail = scanResult.detections
          .map(d => `• ${d.ruleName}: ${d.masked} (${d.severity})`)
          .join('\n');
        vscode.window.showInformationMessage(`Detections:\n${detail}`);
      }

      await this.auditLogger.log({
        action:        decision.action === 'BLOCK' ? 'BLOCK' : 'WARN',
        detections:    scanResult.detections,
        promptPreview: current.slice(0, 80),
        source:        'clipboard',
      });

      this.statusBar.setAlert(scanResult.detectionCount);
    } catch {
      // Clipboard access can fail silently (permissions, etc.)
    }
  }
}