// Related gaps: ruvnet/ruflo#3450 (deletion visibility) and #829 (AgentDB integration).
// Newly observed selective ReasoningBank MCP gap; this does not fix all of either issue.
// Retire when upstream provides equivalent qualified exact get/hash-guarded delete.
export const BRIDGE_RUNTIME = String.raw`// ruflo-source-patch (pattern-withdrawal bridge)
function rspPatternId(value) {
    if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return null;
    const id = Number(value);
    return Number.isSafeInteger(id) ? id : null;
}
function rspPatternHash(pattern) {
    return crypto.createHash('sha256').update(pattern.approach, 'utf8').digest('hex');
}
export async function bridgeGetReasoningPattern(options) {
    if (!operationContext.getStore()?.active)
        return withBridgeOperation(() => bridgeGetReasoningPattern(options));
    const id = rspPatternId(options.patternId);
    if (id === null) return { success: false, reason: 'invalid-pattern-id' };
    const registry = await getRegistry(options.dbPath);
    const rb = registry?.get('reasoningBank');
    if (!rb || typeof rb.getPattern !== 'function')
        return { success: false, reason: 'native-pattern-get-unsupported', controller: 'reasoningBank' };
    try {
        const pattern = rb.getPattern(id);
        if (pattern === null) return { success: true, found: false, patternId: options.patternId, controller: 'reasoningBank', dbPath: canonicalDbPath(options.dbPath) };
        if (!pattern || typeof pattern.approach !== 'string' || pattern.id !== id)
            return { success: false, reason: 'invalid-native-pattern', controller: 'reasoningBank' };
        const { embedding, ...value } = pattern;
        return { success: true, found: true, patternId: options.patternId, pattern: value,
            approachSha256: rspPatternHash(pattern), controller: 'reasoningBank',
            deletionSupported: !rb.vectorBackend && typeof rb.deletePattern === 'function',
            dbPath: canonicalDbPath(options.dbPath) };
    } catch (error) { return { success: false, reason: 'native-pattern-get-failed', error: error.message }; }
}
export async function bridgeDeleteReasoningPattern(options) {
    if (!operationContext.getStore()?.active)
        return withBridgeOperation(() => bridgeDeleteReasoningPattern(options));
    const id = rspPatternId(options.patternId);
    if (id === null || !/^[a-f0-9]{64}$/.test(options.expectedApproachSha256 ?? '')
        || typeof options.reason !== 'string' || !options.reason.trim() || options.reason.length > 500)
        return { success: false, reason: 'invalid-pattern-delete-precondition' };
    const registry = await getRegistry(options.dbPath);
    const rb = registry?.get('reasoningBank');
    if (!rb || typeof rb.getPattern !== 'function' || typeof rb.deletePattern !== 'function')
        return { success: false, reason: 'native-pattern-delete-unsupported', controller: 'reasoningBank' };
    // The public legacy API deletes its row/embedding cascade and clears its cache.
    // It does not remove optional VectorBackend IDs; never claim that route safe.
    if (rb.vectorBackend) return { success: false, reason: 'native-vector-delete-unqualified', controller: 'reasoningBank' };
    const guard = await guardValidate(registry, 'delete', { key: options.patternId, namespace: 'reasoning-patterns' });
    if (!guard.allowed) return { success: false, reason: 'mutation-guard-refused' };
    try {
        // Installed public get/delete are synchronous: no await between hash and delete.
        const before = rb.getPattern(id);
        if (before === null) return { success: true, deleted: false, alreadyAbsent: true, patternId: options.patternId, controller: 'reasoningBank' };
        if (!before || before.id !== id || typeof before.approach !== 'string')
            return { success: false, reason: 'invalid-native-pattern' };
        const approachSha256 = rspPatternHash(before);
        if (approachSha256 !== options.expectedApproachSha256)
            return { success: false, reason: 'pattern-hash-mismatch', approachSha256 };
        const deleted = rb.deletePattern(id);
        if (deleted !== true || rb.getPattern(id) !== null)
            return { success: false, reason: 'native-pattern-deletion-unconfirmed', patternId: options.patternId };
        await logAttestation(registry, 'delete', options.patternId, { namespace: 'reasoning-patterns', approachSha256, reason: options.reason });
        return { success: true, deleted: true, patternId: options.patternId, approachSha256,
            controller: 'reasoningBank', verifiedAbsent: true, dbPath: canonicalDbPath(options.dbPath) };
    } catch (error) { return { success: false, reason: 'native-pattern-delete-failed', error: error.message }; }
}
`;
export const TOOL_RUNTIME = String.raw`// ruflo-source-patch (pattern-withdrawal tools)
export const agentdbPatternGet = {
    name: 'agentdb_pattern-get',
    annotations: { readOnlyHint: true, destructiveHint: false },
    description: 'Administrative exact ReasoningBank pattern read by native ID; no ordinary-memory fallback.',
    inputSchema: { type: 'object', additionalProperties: false,
        properties: { patternId: { type: 'string', pattern: '^[1-9][0-9]*$', description: 'Exact positive native ReasoningBank ID' } }, required: ['patternId'] },
    handler: async params => (await getBridge()).bridgeGetReasoningPattern(params),
};
export const agentdbPatternDelete = {
    name: 'agentdb_pattern-delete',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    description: 'Administrative selective native ReasoningBank deletion after exact body-hash precondition. Refuses unqualified vector-backed controllers; no SQL or ordinary-memory fallback.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
        patternId: { type: 'string', pattern: '^[1-9][0-9]*$' },
        expectedApproachSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        reason: { type: 'string', minLength: 1, maxLength: 500 },
    }, required: ['patternId', 'expectedApproachSha256', 'reason'] },
    handler: async params => (await getBridge()).bridgeDeleteReasoningPattern(params),
};
`;
