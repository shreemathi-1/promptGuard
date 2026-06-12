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
exports.StatusBar = void 0;
const vscode = __importStar(require("vscode"));
class StatusBar {
    item;
    constructor() {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.item.command = 'dlp.showAuditLog';
        this.setIdle();
        this.item.show();
    }
    setIdle() {
        this.item.text = '$(shield) DLP';
        this.item.tooltip = 'DLP Guardian — Active. Click to view audit log.';
        this.item.backgroundColor = undefined;
        this.item.color = undefined;
    }
    setScanning() {
        this.item.text = '$(loading~spin) DLP Scanning…';
        this.item.tooltip = 'DLP Guardian — Scanning for sensitive data…';
    }
    setAlert(count) {
        this.item.text = `$(warning) DLP: ${count} issue${count > 1 ? 's' : ''}`;
        this.item.tooltip = `DLP Guardian — ${count} sensitive item(s) detected. Click to view.`;
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        // Auto-reset to idle after 8 seconds
        setTimeout(() => this.setIdle(), 8000);
    }
    setBlocked() {
        this.item.text = '$(error) DLP: BLOCKED';
        this.item.tooltip = 'DLP Guardian — Last prompt was blocked.';
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        setTimeout(() => this.setIdle(), 8000);
    }
    dispose() {
        this.item.dispose();
    }
}
exports.StatusBar = StatusBar;
//# sourceMappingURL=statusBar.js.map