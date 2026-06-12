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
exports.AuditLogger = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
class AuditLogger {
    logPath;
    config;
    constructor(config) {
        this.config = config;
        this.logPath = this.resolveLogPath();
        this.ensureLogDir();
    }
    resolveLogPath() {
        const configured = this.config.get('auditLogPath');
        if (configured)
            return path.resolve(configured);
        return path.join(os.homedir(), '.dlp-guardian', 'audit.jsonl');
    }
    ensureLogDir() {
        const dir = path.dirname(this.logPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
    /**
     * Appends a single audit entry to the JSONL log file.
     * Each line is a complete JSON object (newline-delimited JSON).
     */
    async log(payload) {
        const entry = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            action: payload.action,
            source: payload.source,
            promptPreview: this.sanitizePreview(payload.promptPreview),
            detectionCount: payload.detections.length,
            detections: payload.detections.map(d => ({
                ruleId: d.ruleId,
                ruleName: d.ruleName,
                category: d.category,
                severity: d.severity,
                masked: d.masked,
            })),
            workspaceFolder: this.getWorkspaceFolder(),
        };
        const line = JSON.stringify(entry) + '\n';
        try {
            fs.appendFileSync(this.logPath, line, 'utf8');
        }
        catch (err) {
            console.error('[DLP] Failed to write audit log:', err.message);
        }
    }
    /**
     * Reads and parses the last N audit entries (most recent first).
     */
    readRecent(limit = 50) {
        try {
            if (!fs.existsSync(this.logPath))
                return [];
            const content = fs.readFileSync(this.logPath, 'utf8');
            const lines = content.trim().split('\n').filter(Boolean);
            const entries = lines
                .map(line => {
                try {
                    return JSON.parse(line);
                }
                catch {
                    return null;
                }
            })
                .filter(Boolean);
            return entries.slice(-limit).reverse();
        }
        catch {
            return [];
        }
    }
    getLogPath() {
        return this.logPath;
    }
    sanitizePreview(text) {
        // Never log more than 200 chars in the preview
        return text.slice(0, 200).replace(/\n/g, ' ');
    }
    getWorkspaceFolder() {
        const folders = require('vscode').workspace?.workspaceFolders;
        return folders?.[0]?.uri?.fsPath ?? null;
    }
}
exports.AuditLogger = AuditLogger;
//# sourceMappingURL=auditLogger.js.map