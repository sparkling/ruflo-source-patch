/**
 * Input Validation for MCP Tools
 *
 * Loads @claude-flow/security validators when available
 * and provides lightweight fallback validation otherwise.
 *
 * Addresses #1425: security validators were implemented but never wired to runtime.
 */
// Patterns for input sanitization (inline — no external dependency required)
const SHELL_META = /[;&|`$(){}[\]<>!#\\]/;
const PATH_TRAVERSAL = /\.\.[/\\]/;
const IDENTIFIER_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_\-.:]{0,127}$/;
const GIT_REF_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_\-.:~^/]{0,255}$/;
const NPM_PACKAGE_RE = /^(@[a-zA-Z0-9_\-]+\/)?[a-zA-Z0-9_\-][a-zA-Z0-9_\-.]{0,213}$/;
/**
 * Validate an identifier (agent ID, agent type, namespace, key, etc.)
 * Rejects shell metacharacters and path traversal.
 */
export function validateIdentifier(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        return { valid: false, sanitized: '', error: `${label} must be a non-empty string` };
    }
    if (value.length > 128) {
        return { valid: false, sanitized: '', error: `${label} exceeds 128 characters` };
    }
    if (SHELL_META.test(value)) {
        return { valid: false, sanitized: '', error: `${label} contains disallowed characters` };
    }
    if (PATH_TRAVERSAL.test(value)) {
        return { valid: false, sanitized: '', error: `${label} contains path traversal` };
    }
    if (!IDENTIFIER_RE.test(value)) {
        return { valid: false, sanitized: '', error: `${label} contains invalid characters (allowed: alphanumeric, _, -, ., :)` };
    }
    return { valid: true, sanitized: value };
}
