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
exports.WarningPanel = void 0;
const vscode = __importStar(require("vscode"));
class WarningPanel {
    /**
     * Shows a modal quick-pick warning with action choices.
     * Returns the user's decision.
     */
    async showWarning(decision) {
        const categories = [...new Set(decision.detections.map(d => d.category))].join(', ');
        const sevCounts = this.countBySeverity(decision);
        const detail = `Detected: ${decision.detections.length} item(s)\n` +
            `Categories: ${categories}\n` +
            sevCounts +
            `\n\nMatched policies: ${decision.matchedRules.map(r => r.name).join(', ')}`;
        if (decision.action === 'BLOCK') {
            await vscode.window.showErrorMessage(`🚫 DLP Guardian: Prompt Blocked`, { modal: true, detail });
            return 'cancel';
        }
        const items = [
            { title: '🔐 Mask & Send', isCloseAffordance: false },
            { title: '⚠️ Send Anyway', isCloseAffordance: false },
            { title: '❌ Cancel', isCloseAffordance: true },
        ];
        const result = await vscode.window.showWarningMessage(`⚠️ DLP Guardian: Sensitive Data Detected`, { modal: true, detail }, ...items);
        if (!result || result.title === '❌ Cancel')
            return 'cancel';
        if (result.title === '🔐 Mask & Send')
            return 'mask';
        return 'send-anyway';
    }
    /**
     * Non-modal inline warning (used in chat participant flow).
     */
    async showInlineWarning(decision) {
        const categories = [...new Set(decision.detections.map(d => d.category))].join(', ');
        const choice = await vscode.window.showWarningMessage(`⚠️ DLP: ${decision.detections.length} sensitive item(s) found [${categories}]`, { modal: false }, '🔐 Mask & Send', '⚠️ Send Anyway', '❌ Cancel');
        if (choice === '🔐 Mask & Send')
            return 'mask';
        if (choice === '⚠️ Send Anyway')
            return 'send-anyway';
        return 'cancel';
    }
    countBySeverity(decision) {
        const counts = {};
        for (const d of decision.detections) {
            counts[d.severity] = (counts[d.severity] ?? 0) + 1;
        }
        return Object.entries(counts)
            .sort(([a], [b]) => ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].indexOf(a) - ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].indexOf(b))
            .map(([sev, cnt]) => `${sev}: ${cnt}`)
            .join('  |  ');
    }
}
exports.WarningPanel = WarningPanel;
//# sourceMappingURL=warningPanel.js.map