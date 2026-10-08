import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
function normalize(value) {
    if (Array.isArray(value))
        return value.map(normalize);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value)
            .filter(([, item]) => item !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, normalize(item)]));
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new TypeError('Policy canonicalization rejects non-finite numbers');
    }
    return value;
}
export function canonicalizePolicy(value) {
    return JSON.stringify(normalize(value));
}
export function policyHash(value) {
    return `sha256:${createHash('sha256').update(canonicalizePolicy(value)).digest('hex')}`;
}
export function signPolicyHash(hash, key) {
    return createHmac('sha256', key).update(hash).digest('base64url');
}
export function verifyPolicySignature(hash, signature, key) {
    const expected = Buffer.from(signPolicyHash(hash, key));
    const actual = Buffer.from(signature);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}
//# sourceMappingURL=canonical.js.map