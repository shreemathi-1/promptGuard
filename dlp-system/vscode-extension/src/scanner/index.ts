import * as vscode from 'vscode';
import axios from 'axios';
import { BUILTIN_PATTERNS, DetectionPattern, PatternCategory, Severity } from './patterns';
import { detectHighEntropyStrings, EntropyMatch } from './entropy';
import { ConfigManager } from '../config/configManager';

export interface Detection {
  ruleId:      string;
  ruleName:    string;
  category:    PatternCategory | 'ENTROPY' | 'CUSTOM';
  severity:    Severity;
  match:       string;
  masked:      string;
  start:       number;
  end:         number;
  line:        number;
  column:      number;
  description: string;
}

export interface ScanResult {
  detections:     Detection[];
  detectionCount: number;
  hasBlocking:    boolean;
  scannedAt:      string;
  durationMs:     number;
  inputLength:    number;
}

export class Scanner {
  private config: ConfigManager;

  constructor(config: ConfigManager) {
    this.config = config;
  }

  /**
   * Main scan entry point.
   * Routes to local or backend scanner based on config.
   */
  async scan(text: string): Promise<ScanResult> {
    if (this.config.get<boolean>('useBackend')) {
      return this.scanViaBackend(text);
    }
    return this.scanLocally(text);
  }

  /**
   * Local in-process scan using compiled regex patterns.
   */
  scanLocally(text: string): ScanResult {
    const start      = Date.now();
    const detections: Detection[] = [];

    // ── 1. Regex + keyword patterns ───────────────────────────────────────
    const patterns = this.getActivePatterns();

    for (const p of patterns) {
      // Reset lastIndex for global regexes
      p.pattern.lastIndex = 0;

      let match: RegExpExecArray | null;
      while ((match = p.pattern.exec(text)) !== null) {
        const matchedValue = match[0];
        const { line, column } = this.getLineColumn(text, match.index);

        detections.push({
          ruleId:      p.id,
          ruleName:    p.name,
          category:    p.category,
          severity:    p.severity,
          match:       matchedValue,
          masked:      this.maskValue(matchedValue, p.category),
          start:       match.index,
          end:         match.index + matchedValue.length,
          line,
          column,
          description: p.description,
        });

        // Prevent infinite loop on zero-length match
        if (match.index === p.pattern.lastIndex) {
          p.pattern.lastIndex++;
        }
      }

      p.pattern.lastIndex = 0;
    }

    // ── 2. Entropy detection ──────────────────────────────────────────────
    if (this.config.get<boolean>('entropyDetection')) {
      const entropyMatches = detectHighEntropyStrings(text);
      for (const em of entropyMatches) {
        // Avoid duplicate with regex detections
        const overlap = detections.some(
          d => d.start <= em.start && d.end >= em.end
        );
        if (overlap) continue;

        const { line, column } = this.getLineColumn(text, em.start);
        detections.push({
          ruleId:      'entropy-detector',
          ruleName:    'High-Entropy String',
          category:    'ENTROPY' as any,
          severity:    'HIGH',
          match:       em.value,
          masked:      this.maskValue(em.value, 'API_KEY'),
          start:       em.start,
          end:         em.end,
          line,
          column,
          description: `High-entropy string detected (${em.entropy.toFixed(2)} bits/char) — likely a secret`,
        });
      }
    }

    // ── 3. Deduplicate overlapping detections ─────────────────────────────
    const deduped = this.deduplicateDetections(detections);

    // ── 4. Sort by position ───────────────────────────────────────────────
    deduped.sort((a, b) => a.start - b.start);

    const SEVERITY_RANK: Record<Severity, number> = {
      CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1,
    };

    const hasBlocking = deduped.some(
      d => SEVERITY_RANK[d.severity] >= SEVERITY_RANK['HIGH']
    );

    return {
      detections:     deduped,
      detectionCount: deduped.length,
      hasBlocking,
      scannedAt:      new Date().toISOString(),
      durationMs:     Date.now() - start,
      inputLength:    text.length,
    };
  }

  /**
   * Remote scan via DLP backend API (Feature 06 of the backend project).
   */
  private async scanViaBackend(text: string): Promise<ScanResult> {
    const backendUrl = this.config.get<string>('backendUrl') || 'http://localhost:4000';
    const start      = Date.now();

    try {
      const response = await axios.post(
        `${backendUrl}/api/scan`,
        { text },
        { timeout: 8000 }
      );

      const data = response.data.data;

      // Map backend response to local Detection shape
      const detections: Detection[] = (data.detections ?? []).map((d: any) => ({
        ruleId:      d.patternId,
        ruleName:    d.patternName,
        category:    d.category,
        severity:    d.severity,
        match:       d.match,
        masked:      this.maskValue(d.match, d.category),
        start:       d.start,
        end:         d.end,
        line:        this.getLineColumn(text, d.start).line,
        column:      this.getLineColumn(text, d.start).column,
        description: `Detected by backend rule: ${d.patternName}`,
      }));

      return {
        detections,
        detectionCount: detections.length,
        hasBlocking:    detections.some(d => d.severity === 'CRITICAL' || d.severity === 'HIGH'),
        scannedAt:      data.scannedAt ?? new Date().toISOString(),
        durationMs:     Date.now() - start,
        inputLength:    text.length,
      };
    } catch (err: any) {
      // Fallback to local scan if backend is unreachable
      console.warn('[DLP] Backend unreachable, falling back to local scan:', err.message);
      return this.scanLocally(text);
    }
  }

  /**
   * Builds the active pattern list from built-ins + custom rules.
   * Respects enabled/disabled state from config.
   */
  private getActivePatterns(): DetectionPattern[] {
    const customRules = this.config.get<Array<{
      name: string;
      pattern: string;
      severity: Severity;
    }>>('customRules') ?? [];

    const builtins = BUILTIN_PATTERNS;

    const customs: DetectionPattern[] = customRules
      .map((r, i) => {
        try {
          return {
            id:          `custom-${i}`,
            name:        r.name,
            category:    'CUSTOM' as PatternCategory,
            severity:    r.severity ?? 'MEDIUM',
            pattern:     new RegExp(r.pattern, 'gi'),
            description: `Custom rule: ${r.name}`,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean) as DetectionPattern[];

    return [...builtins, ...customs];
  }

  /**
   * Removes detections that fully overlap with a higher-priority match.
   */
  private deduplicateDetections(detections: Detection[]): Detection[] {
    if (detections.length === 0) return [];

    const RANK: Record<Severity, number> = {
      CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1,
    };

    const sorted = [...detections].sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      return (RANK[b.severity] ?? 0) - (RANK[a.severity] ?? 0);
    });

    const result: Detection[] = [];
    let lastEnd = -1;

    for (const d of sorted) {
      if (d.start >= lastEnd) {
        result.push(d);
        lastEnd = d.end;
      }
    }

    return result;
  }

  /**
   * Converts a character offset to line + column numbers.
   */
  private getLineColumn(text: string, offset: number): { line: number; column: number } {
    const lines = text.slice(0, offset).split('\n');
    return {
      line:   lines.length - 1,
      column: lines[lines.length - 1].length,
    };
  }

  /**
   * Masks a detected value based on its category.
   */
  private maskValue(value: string, category: string): string {
    if (category === 'EMAIL') {
      const [local, domain] = value.split('@');
      if (!domain) return '[EMAIL REDACTED]';
      const maskedLocal = local.length > 3
        ? local.slice(0, 2) + '*'.repeat(local.length - 2)
        : '***';
      return `${maskedLocal}@${domain}`;
    }

    if (category === 'PHONE') {
      return value.slice(0, -4).replace(/\d/g, '*') + value.slice(-4);
    }

    if (value.length <= 8) {
      return '[REDACTED]';
    }

    // Partial mask — show last 4 chars
    const visible = value.slice(-4);
    const masked  = '*'.repeat(Math.min(value.length - 4, 12));
    return `${masked}${visible}`;
  }
}