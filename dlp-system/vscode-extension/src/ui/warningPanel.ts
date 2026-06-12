import * as vscode from 'vscode';
import { PolicyDecision } from '../policies/policyEngine';

export type UserChoice = 'send-anyway' | 'mask' | 'cancel';

export class WarningPanel {
  /**
   * Shows a modal quick-pick warning with action choices.
   * Returns the user's decision.
   */
  async showWarning(decision: PolicyDecision): Promise<UserChoice> {
    const categories = [...new Set(decision.detections.map(d => d.category))].join(', ');
    const sevCounts  = this.countBySeverity(decision);

    const detail =
      `Detected: ${decision.detections.length} item(s)\n` +
      `Categories: ${categories}\n` +
      sevCounts +
      `\n\nMatched policies: ${decision.matchedRules.map(r => r.name).join(', ')}`;

    if (decision.action === 'BLOCK') {
      await vscode.window.showErrorMessage(
        `🚫 DLP Guardian: Prompt Blocked`,
        { modal: true, detail }
      );
      return 'cancel';
    }

    const items: vscode.MessageItem[] = [
      { title: '🔐 Mask & Send', isCloseAffordance: false },
      { title: '⚠️ Send Anyway', isCloseAffordance: false },
      { title: '❌ Cancel',       isCloseAffordance: true  },
    ];

    const result = await vscode.window.showWarningMessage<vscode.MessageItem>(
      `⚠️ DLP Guardian: Sensitive Data Detected`,
      { modal: true, detail },
      ...items
    );

    if (!result || result.title === '❌ Cancel') return 'cancel';
    if (result.title === '🔐 Mask & Send')         return 'mask';
    return 'send-anyway';
  }

  /**
   * Non-modal inline warning (used in chat participant flow).
   */
  async showInlineWarning(decision: PolicyDecision): Promise<UserChoice> {
    const categories = [...new Set(decision.detections.map(d => d.category))].join(', ');

    const choice = await vscode.window.showWarningMessage(
      `⚠️ DLP: ${decision.detections.length} sensitive item(s) found [${categories}]`,
      { modal: false },
      '🔐 Mask & Send',
      '⚠️ Send Anyway',
      '❌ Cancel'
    );

    if (choice === '🔐 Mask & Send')  return 'mask';
    if (choice === '⚠️ Send Anyway') return 'send-anyway';
    return 'cancel';
  }

  private countBySeverity(decision: PolicyDecision): string {
    const counts: Record<string, number> = {};
    for (const d of decision.detections) {
      counts[d.severity] = (counts[d.severity] ?? 0) + 1;
    }
    return Object.entries(counts)
      .sort(([a], [b]) => ['CRITICAL','HIGH','MEDIUM','LOW'].indexOf(a) - ['CRITICAL','HIGH','MEDIUM','LOW'].indexOf(b))
      .map(([sev, cnt]) => `${sev}: ${cnt}`)
      .join('  |  ');
  }
}