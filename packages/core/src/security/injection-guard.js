/**
 * Injection guard — spec §17
 * Sanitizes string fields at ingress. Truncates overflows.
 * Returns truncated string; caller logs ThreatEvent if truncation occurred.
 */
export const INTENT_MAX_CHARS = 500;
export const RISK_NOTE_MAX_CHARS = 200;
const INJECTION_PATTERNS = [
    /\bignore\s+previous\s+instructions?\b/i,
    /\bsystem\s*prompt\b/i,
    /<\s*script[^>]*>/i,
    /\bexec\s*\(/i,
    /\beval\s*\(/i,
    /\bdrop\s+table\b/i,
];
export function guardString(raw, maxLen) {
    let value = raw;
    const truncated = value.length > maxLen;
    if (truncated)
        value = value.slice(0, maxLen - 1) + '…';
    let injectionDetected = false;
    for (const pat of INJECTION_PATTERNS) {
        if (pat.test(value)) {
            injectionDetected = true;
            value = value.replace(pat, '[REDACTED:INJECTION]');
        }
    }
    return { value, truncated, injectionDetected };
}
