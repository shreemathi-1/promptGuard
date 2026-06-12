import * as vscode from 'vscode';

export class StatusBar {
  private item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.item.command = 'dlp.showAuditLog';
    this.setIdle();
    this.item.show();
  }

  setIdle(): void {
    this.item.text           = '$(shield) DLP';
    this.item.tooltip        = 'DLP Guardian — Active. Click to view audit log.';
    this.item.backgroundColor = undefined;
    this.item.color          = undefined;
  }

  setScanning(): void {
    this.item.text    = '$(loading~spin) DLP Scanning…';
    this.item.tooltip = 'DLP Guardian — Scanning for sensitive data…';
  }

  setAlert(count: number): void {
    this.item.text            = `$(warning) DLP: ${count} issue${count > 1 ? 's' : ''}`;
    this.item.tooltip         = `DLP Guardian — ${count} sensitive item(s) detected. Click to view.`;
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');

    // Auto-reset to idle after 8 seconds
    setTimeout(() => this.setIdle(), 8000);
  }

  setBlocked(): void {
    this.item.text            = '$(error) DLP: BLOCKED';
    this.item.tooltip         = 'DLP Guardian — Last prompt was blocked.';
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    setTimeout(() => this.setIdle(), 8000);
  }

  dispose(): void {
    this.item.dispose();
  }
}