"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Scanner = void 0;
const axios_1 = __importDefault(require("axios"));
const patterns_1 = require("./patterns");
const entropy_1 = require("./entropy");
class Scanner {
    config;
    constructor(config) {
        this.config = config;
    }
    /**
     * Main scan entry point.
     * Routes to local or backend scanner based on config.
     */
    async scan(text) {
        if (this.config.get('useBackend')) {
            return this.scanViaBackend(text);
        }
        return this.scanLocally(text);
    }
    /**
     * Local in-process scan using compiled regex patterns.
     */
    scanLocally(text) {
        const start = Date.now();
        const detections = [];
        // ── 1. Regex + keyword patterns ───────────────────────────────────────
        const patterns = this.getActivePatterns();
        for (const p of patterns) {
            // Reset lastIndex for global regexes
            p.pattern.lastIndex = 0;
            let match;
            while ((match = p.pattern.exec(text)) !== null) {
                const matchedValue = match[0];
                const { line, column } = this.getLineColumn(text, match.index);
                detections.push({
                    ruleId: p.id,
                    ruleName: p.name,
                    category: p.category,
                    severity: p.severity,
                    match: matchedValue,
                    masked: this.maskValue(matchedValue, p.category),
                    start: match.index,
                    end: match.index + matchedValue.length,
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
        if (this.config.get('entropyDetection')) {
            const entropyMatches = (0, entropy_1.detectHighEntropyStrings)(text);
            for (const em of entropyMatches) {
                // Avoid duplicate with regex detections
                const overlap = detections.some(d => d.start <= em.start && d.end >= em.end);
                if (overlap)
                    continue;
                const { line, column } = this.getLineColumn(text, em.start);
                detections.push({
                    ruleId: 'entropy-detector',
                    ruleName: 'High-Entropy String',
                    category: 'ENTROPY',
                    severity: 'HIGH',
                    match: em.value,
                    masked: this.maskValue(em.value, 'API_KEY'),
                    start: em.start,
                    end: em.end,
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
        const SEVERITY_RANK = {
            CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1,
        };
        const hasBlocking = deduped.some(d => SEVERITY_RANK[d.severity] >= SEVERITY_RANK['HIGH']);
        return {
            detections: deduped,
            detectionCount: deduped.length,
            hasBlocking,
            scannedAt: new Date().toISOString(),
            durationMs: Date.now() - start,
            inputLength: text.length,
        };
    }
    /**
     * Remote scan via DLP backend API (Feature 06 of the backend project).
     */
    async scanViaBackend(text) {
        const backendUrl = this.config.get('backendUrl') || 'http://localhost:4000';
        const start = Date.now();
        try {
            const response = await axios_1.default.post(`${backendUrl}/api/scan`, { text }, { timeout: 8000 });
            const data = response.data.data;
            // Map backend response to local Detection shape
            const detections = (data.detections ?? []).map((d) => ({
                ruleId: d.patternId,
                ruleName: d.patternName,
                category: d.category,
                severity: d.severity,
                match: d.match,
                masked: this.maskValue(d.match, d.category),
                start: d.start,
                end: d.end,
                line: this.getLineColumn(text, d.start).line,
                column: this.getLineColumn(text, d.start).column,
                description: `Detected by backend rule: ${d.patternName}`,
            }));
            return {
                detections,
                detectionCount: detections.length,
                hasBlocking: detections.some(d => d.severity === 'CRITICAL' || d.severity === 'HIGH'),
                scannedAt: data.scannedAt ?? new Date().toISOString(),
                durationMs: Date.now() - start,
                inputLength: text.length,
            };
        }
        catch (err) {
            // Fallback to local scan if backend is unreachable
            console.warn('[DLP] Backend unreachable, falling back to local scan:', err.message);
            return this.scanLocally(text);
        }
    }
    /**
     * Builds the active pattern list from built-ins + custom rules.
     * Respects enabled/disabled state from config.
     */
    getActivePatterns() {
        const customRules = this.config.get('customRules') ?? [];
        const builtins = patterns_1.BUILTIN_PATTERNS;
        const customs = customRules
            .map((r, i) => {
            try {
                return {
                    id: `custom-${i}`,
                    name: r.name,
                    category: 'CUSTOM',
                    severity: r.severity ?? 'MEDIUM',
                    pattern: new RegExp(r.pattern, 'gi'),
                    description: `Custom rule: ${r.name}`,
                };
            }
            catch {
                return null;
            }
        })
            .filter(Boolean);
        return [...builtins, ...customs];
    }
    /**
     * Removes detections that fully overlap with a higher-priority match.
     */
    deduplicateDetections(detections) {
        if (detections.length === 0)
            return [];
        const RANK = {
            CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1,
        };
        const sorted = [...detections].sort((a, b) => {
            if (a.start !== b.start)
                return a.start - b.start;
            return (RANK[b.severity] ?? 0) - (RANK[a.severity] ?? 0);
        });
        const result = [];
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
    getLineColumn(text, offset) {
        const lines = text.slice(0, offset).split('\n');
        return {
            line: lines.length - 1,
            column: lines[lines.length - 1].length,
        };
    }
    /**
     * Masks a detected value based on its category.
     */
    maskValue(value, category) {
        if (category === 'EMAIL') {
            const [local, domain] = value.split('@');
            if (!domain)
                return '[EMAIL REDACTED]';
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
        const masked = '*'.repeat(Math.min(value.length - 4, 12));
        return `${masked}${visible}`;
    }
}
exports.Scanner = Scanner;
//# sourceMappingURL=index.js.map