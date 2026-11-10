export const MODEL_ID_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$';
export const MODEL_ID_MAX_LENGTH = 256;
const MODEL_ID_RE = new RegExp(MODEL_ID_PATTERN);
/** Returns an error message for an invalid model value, or null when it is valid. */
export function modelIdError(value, label = 'model') {
    if (typeof value !== 'string' || value.length === 0) {
        return `${label} must be a non-empty string`;
    }
    if (value.length > MODEL_ID_MAX_LENGTH) {
        return `${label} exceeds ${MODEL_ID_MAX_LENGTH} characters`;
    }
    if (!MODEL_ID_RE.test(value)) {
        return `${label} contains invalid characters (must start with a letter or digit; allowed: letters, digits, . _ : / @ + -)`;
    }
    return null;
}
