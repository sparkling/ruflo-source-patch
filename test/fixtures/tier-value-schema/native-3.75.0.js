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
export const agentdbHierarchicalStore = {
    name: 'agentdb_hierarchical-store',
    description: 'Store to hierarchical memory with tier (working, episodic, semantic) Use when generic memory_* tools are wrong because you need AgentDB-specific controllers (HNSW vector search, hierarchical tiers, causal-graph links, pattern store/recall, RaBitQ quantization). For simple key-value persistence, memory_store/memory_retrieve are simpler. For unrelated file work, native Read/Write are fine.',
    inputSchema: {
        type: 'object',
        properties: {
            key: { type: 'string', description: 'Memory entry key' },
            value: {
                type: 'string',
                minLength: 1,
                maxLength: 10000,
                description: 'Memory entry value. Non-empty, max 10000 UTF-16 code units (JavaScript string length); longer values are refused. JSON Schema maxLength counts code points, so text with astral characters (emoji, some CJK) can pass this schema and still exceed the limit — each such character counts as 2.',
            },
            tier: {
                type: 'string',
                description: 'Memory tier (working, episodic, semantic)',
                enum: ['working', 'episodic', 'semantic'],
                default: 'working',
            },
            validFrom: {
                type: 'string',
                description: 'Optional ISO-8601 timestamp from which this fact is valid (temporal validity — Zep/Graphiti-style). Omit for always-valid.',
            },
            validUntil: {
                type: 'string',
                description: 'Optional ISO-8601 timestamp after which this fact is no longer valid. Expired facts are hidden from recall unless includeExpired=true.',
            },
            supersedes: {
                type: 'string',
                description: 'Optional id (or key) of an existing entry this fact supersedes. The old entry is INVALIDATED (stamped validUntil=now + supersededBy=<new id>), not deleted — it stays auditable via recall includeExpired=true.',
            },
        },
        required: ['key', 'value'],
    },
    handler: async (params) => {
        try {
            const vKey = validateIdentifier(params.key, 'key');
            if (!vKey.valid)
                return { success: false, error: vKey.error };
            const vValue = validateText(params.value, 'value');
            if (!vValue.valid)
                return { success: false, error: vValue.error };
            if (params.tier) {
                const vTier = validateIdentifier(params.tier, 'tier');
                if (!vTier.valid)
                    return { success: false, error: vTier.error };
            }
            const key = validateString(params.key, 'key', 1000);
            const value = validateString(params.value, 'value');
            if (!key)
                return { success: false, error: 'key is required (non-empty string, max 1KB)' };
            if (!value)
                return { success: false, error: 'value is required (non-empty string, max 10000 characters)' };
            const tier = validateString(params.tier, 'tier', 20) ?? 'working';
            if (!['working', 'episodic', 'semantic'].includes(tier)) {
                return { success: false, error: `Invalid tier: ${tier}. Must be working, episodic, or semantic` };
            }
            // Temporal validity fields (all optional, backward compatible)
            const validFrom = validateIsoTimestamp(params.validFrom, 'validFrom');
            if (validFrom.error)
                return { success: false, error: validFrom.error };
            const validUntil = validateIsoTimestamp(params.validUntil, 'validUntil');
            if (validUntil.error)
                return { success: false, error: validUntil.error };
            const supersedes = params.supersedes !== undefined
                ? validateString(params.supersedes, 'supersedes', 1000)
                : undefined;
            if (params.supersedes !== undefined && !supersedes) {
                return { success: false, error: 'supersedes must be a non-empty string (entry id or key, max 1KB)' };
            }
            const bridge = await getBridge();
            const result = await bridge.bridgeHierarchicalStore({
                key, value, tier,
                validFrom: validFrom.value,
                validUntil: validUntil.value,
                supersedes: supersedes ?? undefined,
            });
            return result ?? { success: false, error: 'AgentDB bridge not available. Use memory_store/memory_search instead.' };
        }
        catch (error) {
            return { success: false, error: sanitizeError(error) };
        }
    },
};
// ===== agentdb_hierarchical_recall
