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
exports.Decorations = void 0;
const vscode = __importStar(require("vscode"));
/**
 * Manages editor inline highlight decorations for detected sensitive data.
 */
class Decorations {
    criticalDeco;
    highDeco;
    mediumDeco;
    lowDeco;
    constructor() {
        this.criticalDeco = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(255, 0, 80, 0.25)',
            border: '1px solid rgba(255, 0, 80, 0.7)',
            borderRadius: '3px',
            overviewRulerColor: '#ff0050',
            overviewRulerLane: vscode.OverviewRulerLane.Right,
            after: {
                contentText: ' ⛔ CRITICAL',
                color: '#ff6680',
                fontStyle: 'italic',
                margin: '0 0 0 6px',
            },
        });
        this.highDeco = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(255, 120, 0, 0.2)',
            border: '1px solid rgba(255, 120, 0, 0.6)',
            borderRadius: '3px',
            overviewRulerColor: '#ff7800',
            overviewRulerLane: vscode.OverviewRulerLane.Right,
            after: {
                contentText: ' ⚠ HIGH',
                color: '#ffaa55',
                fontStyle: 'italic',
                margin: '0 0 0 6px',
            },
        });
        this.mediumDeco = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(255, 200, 0, 0.15)',
            border: '1px solid rgba(255, 200, 0, 0.5)',
            borderRadius: '3px',
            overviewRulerColor: '#ffc800',
            overviewRulerLane: vscode.OverviewRulerLane.Right,
        });
        this.lowDeco = vscode.window.createTextEditorDecorationType({
            backgroundColor: 'rgba(100, 200, 100, 0.12)',
            border: '1px dashed rgba(100, 200, 100, 0.4)',
            borderRadius: '3px',
        });
    }
    /**
     * Applies colour-coded decorations for each detection in the editor.
     *
     * @param editor     — target editor
     * @param anchor     — selection or range used as offset base
     * @param detections — detections from the scanner (offsets relative to scanned text)
     */
    applyDetections(editor, anchor, detections) {
        this.clearAll(editor);
        const anchorStart = editor.document.offsetAt(anchor.start);
        const criticalRanges = [];
        const highRanges = [];
        const mediumRanges = [];
        const lowRanges = [];
        for (const d of detections) {
            const absStart = anchorStart + d.start;
            const absEnd = anchorStart + d.end;
            const startPos = editor.document.positionAt(absStart);
            const endPos = editor.document.positionAt(absEnd);
            const range = new vscode.Range(startPos, endPos);
            const hoverMessage = new vscode.MarkdownString(`**DLP Guardian** — ${d.ruleName}\n\n` +
                `- Category: \`${d.category}\`\n` +
                `- Severity: **${d.severity}**\n` +
                `- Masked: \`${d.masked}\`\n\n` +
                `*${d.description}*`);
            hoverMessage.isTrusted = true;
            const options = {
                range,
                hoverMessage,
            };
            switch (d.severity) {
                case 'CRITICAL':
                    criticalRanges.push(options);
                    break;
                case 'HIGH':
                    highRanges.push(options);
                    break;
                case 'MEDIUM':
                    mediumRanges.push(options);
                    break;
                case 'LOW':
                    lowRanges.push(options);
                    break;
            }
        }
        editor.setDecorations(this.criticalDeco, criticalRanges);
        editor.setDecorations(this.highDeco, highRanges);
        editor.setDecorations(this.mediumDeco, mediumRanges);
        editor.setDecorations(this.lowDeco, lowRanges);
    }
    clearAll(editor) {
        editor.setDecorations(this.criticalDeco, []);
        editor.setDecorations(this.highDeco, []);
        editor.setDecorations(this.mediumDeco, []);
        editor.setDecorations(this.lowDeco, []);
    }
    dispose() {
        this.criticalDeco.dispose();
        this.highDeco.dispose();
        this.mediumDeco.dispose();
        this.lowDeco.dispose();
    }
}
exports.Decorations = Decorations;
//# sourceMappingURL=decorations.js.map