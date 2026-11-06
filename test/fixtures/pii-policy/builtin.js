import { createHash } from 'node:crypto';
const THREAT_PATTERNS = [
    {
        type: 'prompt-injection',
        severity: 'high',
        confidence: 0.96,
        description: 'Attempts to override or discard trusted instructions',
        pattern: /\b(?:ignore|disregard|forget|override)\b[\s\S]{0,40}\b(?:previous|prior|system|developer|trusted)\b[\s\S]{0,24}\b(?:instructions?|prompts?|rules?|messages?)\b/i,
    },
    {
        type: 'system-prompt-extraction',
        severity: 'high',
        confidence: 0.94,
        description: 'Attempts to reveal hidden system or developer instructions',
        pattern: /\b(?:reveal|show|print|repeat|dump|expose)\b[\s\S]{0,32}\b(?:system|developer|hidden|initial)\b[\s\S]{0,20}\b(?:prompt|message|instructions?)\b/i,
    },
    {
        type: 'jailbreak',
        severity: 'high',
        confidence: 0.91,
        description: 'Attempts to bypass model safeguards or enter an unrestricted mode',
        pattern: /\b(?:developer mode|DAN mode|jailbreak|bypass (?:all )?(?:safeguards|restrictions|filters)|unrestricted mode)\b/i,
    },
    {
        type: 'data-exfiltration',
        severity: 'critical',
        confidence: 0.93,
        description: 'Attempts to transmit secrets or credentials to an external destination',
        pattern: /\b(?:send|upload|post|exfiltrate|transmit)\b[\s\S]{0,48}\b(?:secret|credential|password|api key|token|private key)\b/i,
    },
];
const PII_PATTERNS = [
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /\b\d{3}-\d{2}-\d{4}\b/,
    /\b(?:sk-|ghp_|xox[baprs]-)[A-Za-z0-9_-]{16,}\b/,
    /\bAKIA[A-Z0-9]{16}\b/,
];
export function createBuiltinAIDefence() {
    let detectionCount = 0;
    let totalDetectionTimeMs = 0;
    const scan = (input) => THREAT_PATTERNS
        .filter(({ pattern }) => pattern.test(input))
        .map(({ pattern: _pattern, ...threat }) => threat);
    return {
        async detect(input) {
            const startedAt = performance.now();
            const threats = scan(input);
            const piiFound = PII_PATTERNS.some((pattern) => pattern.test(input));
            const detectionTimeMs = performance.now() - startedAt;
            detectionCount++;
            totalDetectionTimeMs += detectionTimeMs;
            return {
                safe: threats.length === 0 && !piiFound,
                threats,
                piiFound,
                detectionTimeMs,
                inputHash: createHash('sha256').update(input).digest('hex'),
            };
        },
        quickScan(input) {
            const threat = scan(input)[0];
            return threat
                ? { threat: true, confidence: threat.confidence, type: threat.type }
                : { threat: false, confidence: 0 };
        },
        async getStats() {
            return {
                detectionCount,
                avgDetectionTimeMs: detectionCount === 0 ? 0 : totalDetectionTimeMs / detectionCount,
                learnedPatterns: 0,
                mitigationStrategies: 4,
                avgMitigationEffectiveness: 0.9,
            };
        },
        async getBestMitigation(type) {
            const strategies = {
                'prompt-injection': 'Keep trusted instructions immutable and reject instruction overrides',
                'system-prompt-extraction': 'Do not disclose system or developer messages',
                jailbreak: 'Apply the configured policy without adopting alternate personas',
                'data-exfiltration': 'Block external transmission and rotate exposed credentials',
            };
            return strategies[type] ? { strategy: strategies[type], effectiveness: 0.9 } : null;
        },
    };
}
//# sourceMappingURL=builtin-aidefence.js.map