import * as vscode from 'vscode';
import { ConfigManager }     from './config/configManager';
import { Scanner }           from './scanner';
import { PolicyEngine }      from './policies/policyEngine';
import { Masker }            from './masking/masker';
import { AuditLogger }       from './audit/auditLogger';
import { WarningPanel }      from './ui/warningPanel';
import { Decorations }       from './ui/decorations';
import { StatusBar }         from './ui/statusBar';
import { ClipboardMonitor }  from './interceptor/clipboardMonitor';
import { SelectionWatcher }  from './interceptor/selectionWatcher';
import { registerChatParticipant } from './interceptor/chatParticipant';

export function activate(context: vscode.ExtensionContext): void {
  console.log('[DLP Guardian] Activating…');

  // ── 1. Wire up all services ───────────────────────────────────────────────
  const config       = new ConfigManager();
  const scanner      = new Scanner(config);
  const policyEngine = new PolicyEngine(config);
  const masker       = new Masker();
  const auditLogger  = new AuditLogger(config);
  const warningPanel = new WarningPanel();
  const decorations  = new Decorations();
  const statusBar    = new StatusBar();

  // ── 2. Interceptors ───────────────────────────────────────────────────────
  const clipboardMonitor = new ClipboardMonitor(
    scanner, policyEngine, auditLogger, statusBar
  );

  const selectionWatcher = new SelectionWatcher(
    scanner, policyEngine, decorations, auditLogger
  );

  // ── 3. Start monitors (if enabled) ────────────────────────────────────────
  if (config.get<boolean>('enabled')) {
    if (config.get<boolean>('clipboardMonitor')) {
      clipboardMonitor.start();
    }
  }

  // ── 4. Register chat participant ──────────────────────────────────────────
  const chatParticipantDisposable = registerChatParticipant(
    context, scanner, policyEngine, masker, auditLogger, warningPanel
  );

  // ── 5. Register commands ──────────────────────────────────────────────────

  // Command: Secure Send Selection to AI
  const secureSendCmd = vscode.commands.registerCommand(
    'dlp.secureSend',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('DLP: No active editor.');
        return;
      }

      const selection = editor.selection;
      if (selection.isEmpty) {
        vscode.window.showWarningMessage('DLP: No text selected. Select text first.');
        return;
      }

      const selectedText = editor.document.getText(selection);
      statusBar.setScanning();

      const scanResult = await scanner.scan(selectedText);
      const decision   = policyEngine.evaluate(scanResult);

      if (decision.action === 'ALLOW' || scanResult.detectionCount === 0) {
        statusBar.setIdle();
        // Copy clean text to clipboard for pasting into any AI tool
        await vscode.env.clipboard.writeText(selectedText);
        vscode.window.showInformationMessage('DLP: Selection is clean — copied to clipboard.');
        return;
      }

      if (decision.action === 'BLOCK') {
        statusBar.setBlocked();
        await auditLogger.log({
          action:        'BLOCK',
          detections:    scanResult.detections,
          promptPreview: selectedText.slice(0, 100),
          source:        'secure-send-command',
        });
        vscode.window.showErrorMessage(decision.message, { modal: true });
        return;
      }

      // WARN or MASK
      const userChoice = await warningPanel.showWarning(decision);

      if (userChoice === 'cancel') {
        statusBar.setIdle();
        await auditLogger.log({
          action:        'CANCEL',
          detections:    scanResult.detections,
          promptPreview: selectedText.slice(0, 100),
          source:        'secure-send-command',
        });
        return;
      }

      let textToSend = selectedText;

      if (userChoice === 'mask' || decision.action === 'MASK') {
        const maskResult = masker.mask(selectedText, scanResult.detections, 'REDACT');
        textToSend       = maskResult.maskedText;
        await auditLogger.log({
          action:        'MASK_AND_SEND',
          detections:    scanResult.detections,
          promptPreview: selectedText.slice(0, 100),
          source:        'secure-send-command',
        });
      } else {
        await auditLogger.log({
          action:        'WARN_OVERRIDE',
          detections:    scanResult.detections,
          promptPreview: selectedText.slice(0, 100),
          source:        'secure-send-command',
        });
      }

      // Copy final text to clipboard so user can paste into any AI tool
      await vscode.env.clipboard.writeText(textToSend);
      statusBar.setIdle();
      vscode.window.showInformationMessage(
        `DLP: Text ${userChoice === 'mask' ? 'masked and ' : ''}copied to clipboard — paste into your AI tool.`
      );
    }
  );

  // Command: Scan Current File
  const scanFileCmd = vscode.commands.registerCommand(
    'dlp.scanCurrentFile',
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('DLP: No active editor.');
        return;
      }
      statusBar.setScanning();
      await selectionWatcher.scanFullDocument(editor);
      statusBar.setIdle();
    }
  );

  // Command: Scan Clipboard
  const scanClipboardCmd = vscode.commands.registerCommand(
    'dlp.scanClipboard',
    async () => {
      const text = await vscode.env.clipboard.readText();
      if (!text.trim()) {
        vscode.window.showInformationMessage('DLP: Clipboard is empty.');
        return;
      }

      statusBar.setScanning();
      const scanResult = await scanner.scan(text);

      if (scanResult.detectionCount === 0) {
        statusBar.setIdle();
        vscode.window.showInformationMessage('DLP: Clipboard is clean — no sensitive data found.');
        return;
      }

      const decision = policyEngine.evaluate(scanResult);
      statusBar.setAlert(scanResult.detectionCount);

      const lines = scanResult.detections
        .map(d => `• [${d.severity}] ${d.ruleName}: ${d.masked}`)
        .join('\n');

      const choice = await vscode.window.showWarningMessage(
        `DLP: ${scanResult.detectionCount} item(s) found in clipboard`,
        { modal: true, detail: lines },
        '🔐 Mask & Replace Clipboard',
        '🗑 Clear Clipboard',
        '❌ Dismiss'
      );

      if (choice === '🔐 Mask & Replace Clipboard') {
        const maskResult = masker.mask(text, scanResult.detections, 'REDACT');
        await vscode.env.clipboard.writeText(maskResult.maskedText);
        vscode.window.showInformationMessage('DLP: Clipboard replaced with masked content.');
      }

      if (choice === '🗑 Clear Clipboard') {
        await vscode.env.clipboard.writeText('');
        vscode.window.showInformationMessage('DLP: Clipboard cleared.');
      }

      await auditLogger.log({
        action:        decision.action,
        detections:    scanResult.detections,
        promptPreview: text.slice(0, 100),
        source:        'clipboard-scan-command',
      });
    }
  );

  // Command: Show Audit Log
  const showAuditCmd = vscode.commands.registerCommand(
    'dlp.showAuditLog',
    async () => {
      const entries = auditLogger.readRecent(50);

      if (entries.length === 0) {
        vscode.window.showInformationMessage(
          `DLP Audit Log: No entries yet. Log path: ${auditLogger.getLogPath()}`
        );
        return;
      }

      // Show log in an untitled editor with JSON content
      const content = entries.map(e =>
        `[${e.timestamp}] ACTION=${e.action} SOURCE=${e.source} ` +
        `DETECTIONS=${e.detectionCount} PREVIEW="${e.promptPreview}"\n` +
        e.detections.map(d => `  └── [${d.severity}] ${d.ruleName}: ${d.masked}`).join('\n')
      ).join('\n\n');

      const doc = await vscode.workspace.openTextDocument({
        content,
        language: 'plaintext',
      });

      await vscode.window.showTextDocument(doc, { preview: false });
    }
  );

  // Command: Open Policy Settings
  const openSettingsCmd = vscode.commands.registerCommand(
    'dlp.openSettings',
    () => vscode.commands.executeCommand(
      'workbench.action.openSettings',
      'dlp'
    )
  );

  // ── 6. Register selection watcher ─────────────────────────────────────────
  const selectionWatcherDisposable = selectionWatcher.register();

  // ── 7. React to config changes ────────────────────────────────────────────
  const configChangeDisposable = config.onChange(() => {
    policyEngine.reload();

    // Toggle clipboard monitor based on new config
    if (config.get<boolean>('enabled') && config.get<boolean>('clipboardMonitor')) {
      clipboardMonitor.start();
    } else {
      clipboardMonitor.stop();
    }
  });

  // ── 8. Add all disposables to context ────────────────────────────────────
  context.subscriptions.push(
    chatParticipantDisposable,
    secureSendCmd,
    scanFileCmd,
    scanClipboardCmd,
    showAuditCmd,
    openSettingsCmd,
    selectionWatcherDisposable,
    configChangeDisposable,
    { dispose: () => clipboardMonitor.stop() },
    { dispose: () => decorations.dispose() },
    { dispose: () => statusBar.dispose() },
  );

  console.log('[DLP Guardian] Activated successfully.');
  vscode.window.showInformationMessage('DLP Guardian is active — protecting your AI prompts.');
}

export function deactivate(): void {
  console.log('[DLP Guardian] Deactivated.');
}