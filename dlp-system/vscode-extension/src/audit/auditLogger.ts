import * as fs   from 'fs';
import * as path from 'path';
import * as os   from 'os';
import { Detection } from '../scanner';
import { ConfigManager } from '../config/configManager';

export interface AuditEntry {
  id:            string;
  timestamp:     string;
  action:        string;
  source:        string;
  promptPreview: string;
  detectionCount: number;
  detections:    Array<{
    ruleId:    string;
    ruleName:  string;
    category:  string;
    severity:  string;
    masked:    string;
  }>;
  workspaceFolder: string | null;
}

export interface LogPayload {
  action:        string;
  detections:    Detection[];
  promptPreview: string;
  source:        string;
}

export class AuditLogger {
  private logPath: string;
  private config:  ConfigManager;

  constructor(config: ConfigManager) {
    this.config  = config;
    this.logPath = this.resolveLogPath();
    this.ensureLogDir();
  }

  private resolveLogPath(): string {
    const configured = this.config.get<string>('auditLogPath');
    if (configured) return path.resolve(configured);
    return path.join(os.homedir(), '.dlp-guardian', 'audit.jsonl');
  }

  private ensureLogDir(): void {
    const dir = path.dirname(this.logPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Appends a single audit entry to the JSONL log file.
   * Each line is a complete JSON object (newline-delimited JSON).
   */
  async log(payload: LogPayload): Promise<void> {
    const entry: AuditEntry = {
      id:             crypto.randomUUID(),
      timestamp:      new Date().toISOString(),
      action:         payload.action,
      source:         payload.source,
      promptPreview:  this.sanitizePreview(payload.promptPreview),
      detectionCount: payload.detections.length,
      detections:     payload.detections.map(d => ({
        ruleId:   d.ruleId,
        ruleName: d.ruleName,
        category: d.category,
        severity: d.severity,
        masked:   d.masked,
      })),
      workspaceFolder: this.getWorkspaceFolder(),
    };

    const line = JSON.stringify(entry) + '\n';

    try {
      fs.appendFileSync(this.logPath, line, 'utf8');
    } catch (err: any) {
      console.error('[DLP] Failed to write audit log:', err.message);
    }
  }

  /**
   * Reads and parses the last N audit entries (most recent first).
   */
  readRecent(limit: number = 50): AuditEntry[] {
    try {
      if (!fs.existsSync(this.logPath)) return [];

      const content = fs.readFileSync(this.logPath, 'utf8');
      const lines   = content.trim().split('\n').filter(Boolean);
      const entries = lines
        .map(line => {
          try { return JSON.parse(line) as AuditEntry; }
          catch { return null; }
        })
        .filter(Boolean) as AuditEntry[];

      return entries.slice(-limit).reverse();
    } catch {
      return [];
    }
  }

  getLogPath(): string {
    return this.logPath;
  }

  private sanitizePreview(text: string): string {
    // Never log more than 200 chars in the preview
    return text.slice(0, 200).replace(/\n/g, ' ');
  }

  private getWorkspaceFolder(): string | null {
    const folders = require('vscode').workspace?.workspaceFolders;
    return folders?.[0]?.uri?.fsPath ?? null;
  }
}