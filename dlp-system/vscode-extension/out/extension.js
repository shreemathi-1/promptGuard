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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const configManager_1 = require("./config/configManager");
const scanner_1 = require("./scanner");
const policyEngine_1 = require("./policies/policyEngine");
const masker_1 = require("./masking/masker");
const auditLogger_1 = require("./audit/auditLogger");
const warningPanel_1 = require("./ui/warningPanel");
const decorations_1 = require("./ui/decorations");
const statusBar_1 = require("./ui/statusBar");
const clipboardMonitor_1 = require("./interceptor/clipboardMonitor");
const selectionWatcher_1 = require("./interceptor/selectionWatcher");
const chatParticipant_1 = require("./interceptor/chatParticipant");
function activate(context) {
    console.log('[DLP Guardian] Activating…');
    // ── 1. Wire up all services ───────────────────────────────────────────────
    const config = new configManager_1.ConfigManager();
    const scanner = new scanner_1.Scanner(config);
    const policyEngine = new policyEngine_1.PolicyEngine(config);
    const masker = new masker_1.Masker();
    const auditLogger = new auditLogger_1.AuditLogger(config);
    const warningPanel = new warningPanel_1.WarningPanel();
    const decorations = new decorations_1.Decorations();
    const statusBar = new statusBar_1.StatusBar();
    // ── 2. Interceptors ───────────────────────────────────────────────────────
    const clipboardMonitor = new clipboardMonitor_1.ClipboardMonitor(scanner, policyEngine, auditLogger, statusBar);
    const selectionWatcher = new selectionWatcher_1.SelectionWatcher(scanner, policyEngine, decorations, auditLogger);
    // ── 3. Start monitors (if enabled) ────────────────────────────────────────
    if (config.get('enabled')) {
        if (config.get('clipboardMonitor')) {
            clipboardMonitor.start();
        }
    }
    // ── 4. Register chat participant ──────────────────────────────────────────
    const chatParticipantDisposable = (0, chatParticipant_1.registerChatParticipant)(context, scanner, policyEngine, masker, auditLogger, warningPanel);
    // ── 5. Register commands ──────────────────────────────────────────────────
    // Command: Secure Send Selection to AI
    const secureSendCmd = vscode.commands.registerCommand('dlp.secureSend', async () => {
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
        const decision = policyEngine.evaluate(scanResult);
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
                action: 'BLOCK',
                detections: scanResult.detections,
                promptPreview: selectedText.slice(0, 100),
                source: 'secure-send-command',
            });
            vscode.window.showErrorMessage(decision.message, { modal: true });
            return;
        }
        // WARN or MASK
        const userChoice = await warningPanel.showWarning(decision);
        if (userChoice === 'cancel') {
            statusBar.setIdle();
            await auditLogger.log({
                action: 'CANCEL',
                detections: scanResult.detections,
                promptPreview: selectedText.slice(0, 100),
                source: 'secure-send-command',
            });
            return;
        }
        let textToSend = selectedText;
        if (userChoice === 'mask' || decision.action === 'MASK') {
            const maskResult = masker.mask(selectedText, scanResult.detections, 'REDACT');
            textToSend = maskResult.maskedText;
            await auditLogger.log({
                action: 'MASK_AND_SEND',
                detections: scanResult.detections,
                promptPreview: selectedText.slice(0, 100),
                source: 'secure-send-command',
            });
        }
        else {
            await auditLogger.log({
                action: 'WARN_OVERRIDE',
                detections: scanResult.detections,
                promptPreview: selectedText.slice(0, 100),
                source: 'secure-send-command',
            });
        }
        // Copy final text to clipboard so user can paste into any AI tool
        await vscode.env.clipboard.writeText(textToSend);
        statusBar.setIdle();
        vscode.window.showInformationMessage(`DLP: Text ${userChoice === 'mask' ? 'masked and ' : ''}copied to clipboard — paste into your AI tool.`);
    });
    // Command: Scan Current File
    const scanFileCmd = vscode.commands.registerCommand('dlp.scanCurrentFile', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('DLP: No active editor.');
            return;
        }
        statusBar.setScanning();
        await selectionWatcher.scanFullDocument(editor);
        statusBar.setIdle();
    });
    // Command: Scan Clipboard
    const scanClipboardCmd = vscode.commands.registerCommand('dlp.scanClipboard', async () => {
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
        const choice = await vscode.window.showWarningMessage(`DLP: ${scanResult.detectionCount} item(s) found in clipboard`, { modal: true, detail: lines }, '🔐 Mask & Replace Clipboard', '🗑 Clear Clipboard', '❌ Dismiss');
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
            action: decision.action,
            detections: scanResult.detections,
            promptPreview: text.slice(0, 100),
            source: 'clipboard-scan-command',
        });
    });
    // Command: Show Audit Log
    const showAuditCmd = vscode.commands.registerCommand('dlp.showAuditLog', async () => {
        const entries = auditLogger.readRecent(50);
        if (entries.length === 0) {
            vscode.window.showInformationMessage(`DLP Audit Log: No entries yet. Log path: ${auditLogger.getLogPath()}`);
            return;
        }
        // Show log in an untitled editor with JSON content
        const content = entries.map(e => `[${e.timestamp}] ACTION=${e.action} SOURCE=${e.source} ` +
            `DETECTIONS=${e.detectionCount} PREVIEW="${e.promptPreview}"\n` +
            e.detections.map(d => `  └── [${d.severity}] ${d.ruleName}: ${d.masked}`).join('\n')).join('\n\n');
        const doc = await vscode.workspace.openTextDocument({
            content,
            language: 'plaintext',
        });
        await vscode.window.showTextDocument(doc, { preview: false });
    });
    // Command: Open Policy Settings
    const openSettingsCmd = vscode.commands.registerCommand('dlp.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', 'dlp'));
    // ── 6. Register selection watcher ─────────────────────────────────────────
    const selectionWatcherDisposable = selectionWatcher.register();
    // ── 7. React to config changes ────────────────────────────────────────────
    const configChangeDisposable = config.onChange(() => {
        policyEngine.reload();
        // Toggle clipboard monitor based on new config
        if (config.get('enabled') && config.get('clipboardMonitor')) {
            clipboardMonitor.start();
        }
        else {
            clipboardMonitor.stop();
        }
    });
    // ── 8. Add all disposables to context ────────────────────────────────────
    context.subscriptions.push(chatParticipantDisposable, secureSendCmd, scanFileCmd, scanClipboardCmd, showAuditCmd, openSettingsCmd, selectionWatcherDisposable, configChangeDisposable, { dispose: () => clipboardMonitor.stop() }, { dispose: () => decorations.dispose() }, { dispose: () => statusBar.dispose() });
    console.log('[DLP Guardian] Activated successfully.');
    vscode.window.showInformationMessage('DLP Guardian is active — protecting your AI prompts.');
}
function deactivate() {
    console.log('[DLP Guardian] Deactivated.');
}
//# sourceMappingURL=extension.js.map