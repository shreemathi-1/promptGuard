"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Masker = void 0;
class Masker {
    /**
     * Applies masking to original text using detection positions.
     * Processes detections right-to-left to preserve character indices.
     */
    mask(originalText, detections, style = 'REDACT') {
        if (detections.length === 0) {
            return { maskedText: originalText, replacements: [], maskedCount: 0 };
        }
        // Sort right-to-left so splicing doesn't shift earlier indices
        const sorted = [...detections].sort((a, b) => b.start - a.start);
        let maskedText = originalText;
        const replacements = [];
        for (const detection of sorted) {
            const { start, end, match, category } = detection;
            if (start < 0 || end > maskedText.length || start >= end) {
                continue;
            }
            const replacement = this.buildReplacement(match, category, style);
            maskedText =
                maskedText.slice(0, start) +
                    replacement +
                    maskedText.slice(end);
            replacements.push({ original: match, replacement, category, start, end });
        }
        replacements.sort((a, b) => a.start - b.start);
        return {
            maskedText,
            replacements,
            maskedCount: replacements.length,
        };
    }
    /**
     * Builds the replacement string for a single detected value.
     */
    buildReplacement(value, category, style) {
        switch (style) {
            case 'REDACT':
                return `[${category} REDACTED]`;
            case 'PARTIAL': {
                if (category === 'EMAIL') {
                    const [local, domain] = value.split('@');
                    if (!domain)
                        return '[EMAIL REDACTED]';
                    const maskedLocal = local.length > 2
                        ? local[0] + '*'.repeat(local.length - 2) + local[local.length - 1]
                        : '***';
                    return `${maskedLocal}@${domain}`;
                }
                if (value.length <= 6)
                    return '*'.repeat(value.length);
                const visible = value.slice(-4);
                return '*'.repeat(value.length - 4) + visible;
            }
            case 'TOKENIZE': {
                // Deterministic short token based on value hash
                const hash = this.simpleHash(value);
                return `[TOKEN:${hash}]`;
            }
            default:
                return `[${category} REDACTED]`;
        }
    }
    /**
     * Simple deterministic hash for tokenization (not cryptographic).
     * For production, use a keyed HMAC.
     */
    simpleHash(str) {
        let h = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = (h * 0x01000193) >>> 0;
        }
        return h.toString(16).padStart(8, '0').toUpperCase();
    }
    /**
     * Masks a single value without position context (for display purposes).
     */
    maskSingle(value, category, style = 'PARTIAL') {
        return this.buildReplacement(value, category, style);
    }
}
exports.Masker = Masker;
//# sourceMappingURL=masker.js.map