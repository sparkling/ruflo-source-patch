const PII_PATTERNS = [
    {
        // Bounded per RFC 5321 (local part ≤ 64, domain ≤ 253): the unbounded `+`
        // quantifiers were quadratic on inputs like `a.a.a…` (3.8 s / 100 KB),
        // and `detect()` runs PII detection on every scan.
        pattern: /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}\b/,
        type: 'email',
        description: 'Email address',
    },
    {
        pattern: /\b\d{3}-\d{2}-\d{4}\b/,
        type: 'ssn',
        description: 'Social Security Number',
    },
    {
        pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/,
        type: 'credit_card',
        description: 'Credit card number',
    },
    {
        pattern: /\b(sk-[a-zA-Z0-9]{20,}|sk-ant-[a-zA-Z0-9-]{20,})\b/,
        type: 'api_key',
        description: 'API key (OpenAI/Anthropic format)',
    },
    {
        pattern: /\b(ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{82})\b/,
        type: 'api_key',
        description: 'GitHub token',
    },
    {
        pattern: /password\s*[:=]\s*["']?[^"'\s]{4,}["']?/i,
        type: 'password',
        description: 'Hardcoded password',
    },
];
class Detector {
    detectPII(input) { return false; }
}
