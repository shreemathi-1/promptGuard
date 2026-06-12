"use strict";
/**
 * Shannon entropy detection for high-randomness strings (secrets, keys).
 * High entropy + certain character sets → likely a secret.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.shannonEntropy = shannonEntropy;
exports.detectHighEntropyStrings = detectHighEntropyStrings;
const BASE64_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
const HEX_CHARSET = '0123456789abcdefABCDEF';
/**
 * Calculates Shannon entropy of a string.
 * Max entropy for random base64 ≈ 6.0 bits/char.
 */
function shannonEntropy(str) {
    if (str.length === 0)
        return 0;
    const freq = {};
    for (const ch of str) {
        freq[ch] = (freq[ch] ?? 0) + 1;
    }
    let entropy = 0;
    for (const count of Object.values(freq)) {
        const p = count / str.length;
        entropy -= p * Math.log2(p);
    }
    return entropy;
}
/**
 * Checks if all characters belong to a known secret charset.
 */
function isLikelyCharset(str, charset) {
    return str.split('').every(c => charset.includes(c));
}
/**
 * Scans text for high-entropy strings that look like secrets.
 * Returns all matches with entropy scores above threshold.
 *
 * @param text       — raw text to scan
 * @param threshold  — minimum entropy (default 4.5 bits/char)
 * @param minLength  — minimum token length to consider (default 20)
 */
function detectHighEntropyStrings(text, threshold = 4.5, minLength = 20) {
    const results = [];
    // Extract quoted strings and long unquoted tokens
    const tokenRegex = /['"`]([a-zA-Z0-9\/+._\-=]{20,80})['"`]|(?<!\w)([a-zA-Z0-9\/+._\-=]{32,80})(?!\w)/g;
    let match;
    while ((match = tokenRegex.exec(text)) !== null) {
        const value = match[1] ?? match[2];
        if (!value || value.length < minLength)
            continue;
        // Skip if it looks like a file path or URL
        if (value.includes('/') && value.split('/').length > 3)
            continue;
        if (value.startsWith('http'))
            continue;
        // Only score if charset looks like a secret
        const isBase64 = isLikelyCharset(value, BASE64_CHARSET);
        const isHex = isLikelyCharset(value, HEX_CHARSET);
        if (!isBase64 && !isHex)
            continue;
        const entropy = shannonEntropy(value);
        if (entropy >= threshold) {
            results.push({
                value,
                entropy,
                start: match.index + (match[0].startsWith("'") || match[0].startsWith('"') || match[0].startsWith('`') ? 1 : 0),
                end: match.index + match[0].length,
            });
        }
    }
    return results;
}
//# sourceMappingURL=entropy.js.map