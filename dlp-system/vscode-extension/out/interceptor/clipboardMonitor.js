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
exports.ClipboardMonitor = void 0;
const vscode = __importStar(require("vscode"));
/**
 * Clipboard Monitor — polls clipboard every N ms and warns on sensitive content.
 *
 * VS Code does not provide a clipboard change event, so we poll.
 * This is the standard approach used by all clipboard-monitoring extensions.
 */
class ClipboardMonitor {
    scanner;
    policyEngine;
    auditLogger;
    statusBar;
    lastClipboard = '';
    timer = null;
    POLL_INTERVAL_MS = 1500;
    constructor(scanner, policyEngine, auditLogger, statusBar) {
        this.scanner = scanner;
        this.policyEngine = policyEngine;
        this.auditLogger = auditLogger;
        this.statusBar = statusBar;
    }
    start() {
        if (this.timer)
            return;
        this.timer = setInterval(() => this.check(), this.POLL_INTERVAL_MS);
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
    async check() {
        try {
            const current = await vscode.env.clipboard.readText();
            if (!current || current === this.lastClipboard)
                return;
            this.lastClipboard = current;
            // Only scan if clipboard content is non-trivial
            if (current.trim().length < 8)
                return;
            const scanResult = await this.scanner.scan(current);
            if (scanResult.detectionCount === 0)
                return;
            const decision = this.policyEngine.evaluate(scanResult);
            if (decision.action === 'ALLOW')
                return;
            // Show a non-blocking notification
            const categories = [...new Set(scanResult.detections.map(d => d.category))].join(', ');
            const message = `DLP Guardian: Clipboard contains sensitive data [${categories}].`;
            const choice = await vscode.window.showWarningMessage(message, { modal: false }, 'Clear Clipboard', 'View Details', 'Dismiss');
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
                action: decision.action === 'BLOCK' ? 'BLOCK' : 'WARN',
                detections: scanResult.detections,
                promptPreview: current.slice(0, 80),
                source: 'clipboard',
            });
            this.statusBar.setAlert(scanResult.detectionCount);
        }
        catch {
            // Clipboard access can fail silently (permissions, etc.)
        }
    }
}
exports.ClipboardMonitor = ClipboardMonitor;
//# sourceMappingURL=clipboardMonitor.js.map