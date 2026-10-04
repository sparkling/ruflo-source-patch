import { feedbackPatternsSchema, validateFeedbackPatterns } from '../memory/feedback-patterns.js';
import { validateIdentifier, validateText } from './validate-input.js';
// ===== Shared validation helpers =====
const MAX_STRING_LENGTH = 100_000; // 100KB max for any string input
const MAX_BATCH_SIZE = 500; // Max entries per batch operation
const MAX_TOP_K = 100; // Max results per query
function validateString(value, name, maxLen = MAX_STRING_LENGTH) {
    if (typeof value !== 'string' || value.length === 0)
        return null;
    if (value.length > maxLen)
        return null;
    return value;
}
function validatePositiveInt(value, defaultVal, max) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return defaultVal;
    const n = Math.floor(value);
    return n > 0 ? Math.min(n, max) : defaultVal;
}
function validateScore(value, defaultVal) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return defaultVal;
    return Math.max(0, Math.min(1, value));
}
/**
 * Validate an optional ISO-8601 timestamp param (temporal validity fields).
 * Returns { value } when absent or valid, { error } when present but unparseable.
 */
function validateIsoTimestamp(value, name) {
    if (value === undefined || value === null)
        return {};
    if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
        return { error: `${name} must be a non-empty ISO-8601 timestamp string (max 64 chars)` };
    }
    if (Number.isNaN(Date.parse(value))) {
        return { error: `${name} is not a parseable ISO-8601 timestamp: ${value.substring(0, 64)}` };
    }
    return { value };
}
function sanitizeError(error) {
    if (error instanceof Error) {
        // Strip filesystem paths from error messages
        return error.message.replace(/\/[^\s:]+\//g, '<path>/').substring(0, 500);
    }
    return 'Internal error';
}
// Lazy-cached bridge module
let bridgeModule = null;
async function getBridge() {
    if (!bridgeModule) {
        bridgeModule = await import('../memory/memory-bridge.js');
    }
    return bridgeModule;
}
// Lazy-cached modules used by graph-query / graph-pathfinder dispatch.
// Caching the resolved namespace avoids per-call dynamic-import overhead
// in the ADR-130 hot path (smoke harness measures elapsedMs of every call).
let graphEdgeWriterMod = null;
async function getGraphEdgeWriter() {
    if (!graphEdgeWriterMod)
        graphEdgeWriterMod = await import('../memory/graph-edge-writer.js');
    return graphEdgeWriterMod;
}
let memInitMod = null;
async function getMemInit() {
    if (!memInitMod)
        memInitMod = await import('../memory/memory-initializer.js');
    return memInitMod;
}
let embQuantMod = null;
async function getEmbQuant() {
    if (!embQuantMod)
        embQuantMod = await import('../memory/embedding-quantization.js');
    return embQuantMod;
}
// ===== agentdb_health — Controller health check =====
export const agentdbHealth = {
    name: 'agentdb_health',
    description: 'Get AgentDB v3 controller health status including cache stats and attestation count Use when generic memory_* tools are wrong because you need AgentDB-specific controllers (HNSW vector search, hierarchical tiers, causal-graph links, pattern store/recall, RaBitQ quantization). For simple key-value persistence, memory_store/memory_retrieve are simpler. For unrelated file work, native Read/Write are fine.',
    inputSchema: {
        type: 'object',
        properties: {},
    },
    handler: async () => {
        try {
            const bridge = await getBridge();
            const health = await bridge.bridgeHealthCheck();
            if (!health)
                return { available: false, error: 'AgentDB bridge not available' };
            return health;
        }
        catch (error) {
            return { available: false, error: sanitizeError(error) };
        }
    },
};
// ===== agentdb_controllers — List all controllers =====
export const agentdbControllers = {
    name: 'agentdb_controllers',
    description: 'List all AgentDB v3 controllers and their initialization status Use when generic memory_* tools are wrong because you need AgentDB-specific controllers (HNSW vector search, hierarchical tiers, causal-graph links, pattern store/recall, RaBitQ quantization). For simple key-value persistence, memory_store/memory_retrieve are simpler. For unrelated file work, native Read/Write are fine.',
    inputSchema: {
        type: 'object',
        properties: {},
    },
    handler: async () => {
        try {
            const bridge = await getBridge();
            const controllers = await bridge.bridgeListControllers();
            if (!controllers)
                return { available: false, controllers: [], error: 'AgentDB bridge not available — @claude-flow/memory not installed or missing controller-registry. Use memory_store/memory_search tools instead.' };
            return {
                available: true,
                controllers,
                total: controllers.length,
                active: controllers.filter((c) => c.enabled).length,
            };
        }
        catch (error) {
            return { available: false, error: sanitizeError(error) };
        }
    },
};
// ===== agentdb_pattern_store — Store via ReasoningBank =====
export const agentdbPatternStore = {
    name: 'agentdb_pattern-store',
    description: 'Store a pattern directly via ReasoningBank controller Use when generic memory_* tools are wrong because you need AgentDB-specific controllers (HNSW vector search, hierarchical tiers, causal-graph links, pattern store/recall, RaBitQ quantization). For simple key-value persistence, memory_store/memory_retrieve are simpler. For unrelated file work, native Read/Write are fine.',
    inputSchema: {
        type: 'object',
        properties: {
            pattern: { type: 'string', description: 'Pattern description' },
            type: { type: 'string', description: 'Pattern type (e.g., task-routing, error-recovery)' },
            confidence: { type: 'number', description: 'Confidence score (0-1)' },
        },
        required: ['pattern'],
    },
    handler: async (params) => {
        try {
            const vPattern = validateText(params.pattern, 'pattern', 100_000);
            if (!vPattern.valid)
                return { success: false, error: vPattern.error };
            if (params.type) {
                const vType = validateIdentifier(params.type, 'type');
                if (!vType.valid)
                    return { success: false, error: vType.error };
            }
            const pattern = validateString(params.pattern, 'pattern');
            if (!pattern)
                return { success: false, error: 'pattern is required (non-empty string, max 100KB)' };
            const type = validateString(params.type, 'type', 200) ?? 'general';
            const confidence = validateScore(params.confidence, 0.8);
            const bridge = await getBridge();
            const result = await bridge.bridgeStorePattern({ pattern, type, confidence });
            if (result) {
                // #3288: `controller: 'reasoningBank'` is the ONLY label that means
                // the healthy path ran. Every other label bridgeStorePattern can
                // return (`bridge-fallback` today; more may be added later) is a
                // degraded write that still reports {success: true} — flag it at
                // this one boundary instead of chasing each fallback label
                // individually, so a new label can't silently reopen this gap.
                if (result.controller === 'reasoningBank')
                    return result;
                return {
                    ...result,
                    degraded: true,
                    reason: `reasoningBank-unavailable:${result.controller}`,
                    note: `ReasoningBank controller unavailable (controller=${result.controller}). Pattern persisted via the fallback path. Run \`agentdb_health\` to inspect controller registration.`,
                };
            }
            // ADR-093 F4: when the ReasoningBank controller registry returns
            // null (the cause of audit-reported "AgentDB bridge not available"
            // even though `agentdb_health.reasoningBank.enabled === true`), fall
            // back to a direct memory_store write so the caller's pattern still
            // persists. Surface the controller as `memory-store-fallback` so the
            // path is observable instead of silently lost.
            try {
                const { storeEntry } = await import('../memory/memory-initializer.js');
                const patternId = `pattern-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                const value = JSON.stringify({ pattern, type, confidence, _fallback: 'reasoningBank-unavailable' });
                await storeEntry({
                    key: patternId,
                    value,
                    namespace: 'pattern',
                    tags: [type, 'reasoning-pattern', 'fallback'],
                });
                return {
                    success: true,
                    // #3288: a caller must not have to already know to distrust a
                    // "successful" response — degraded:true is the structural signal
                    // (matching agentbbs-tools.ts's degradedResult() convention),
                    // `note` stays for the human-readable detail.
                    degraded: true,
                    reason: 'reasoningBank-unavailable:registry-null',
                    patternId,
                    controller: 'memory-store-fallback',
                    note: 'ReasoningBank controller registry unavailable. Pattern persisted via memory_store. Run `agentdb_health` to inspect controller registration.',
                };
            }
            catch (fallbackErr) {
                return {
                    success: false,
                    error: 'Pattern store failed: both ReasoningBank bridge and memory_store fallback unavailable',
                    fallbackError: sanitizeError(fallbackErr),
                    recommendation: 'Run agentdb_health to inspect controller registration and check that .swarm/memory.db is writable.',
                };
            }
        }
        catch (error) {
            return { success: false, error: sanitizeError(error) };
        }
    },
};
