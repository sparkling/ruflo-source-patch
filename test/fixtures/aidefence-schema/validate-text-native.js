export function validateText(value, label, maxLen = 10_000) {
    if (typeof value !== 'string') {
        return { valid: false, sanitized: '', error: `${label} must be a string` };
    }
    if (value.length > maxLen) {
        return { valid: false, sanitized: '', error: `${label} exceeds ${maxLen} characters` };
    }
    // Strip null bytes
    const sanitized = value.replace(/\0/g, '');
    return { valid: true, sanitized };
}
/** Native next section boundary. */
