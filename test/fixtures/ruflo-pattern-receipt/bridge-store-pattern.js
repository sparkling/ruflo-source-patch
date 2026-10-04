export async function bridgeStorePattern(options) {
    if (!operationContext.getStore()?.active)
        return withBridgeOperation(() => bridgeStorePattern(options));
    const registry = await getRegistry(options.dbPath);
    if (!registry)
        return null;
    try {
        const reasoningBank = registry.get('reasoningBank');
        const patternId = generateId('pattern');
        // #3327 Finding A — the real method is `storePattern`, and it takes a
        // ReasoningPattern, NOT the {id, content, type, confidence} shape used
        // here before. `reasoningBank.store` has never existed on agentdb's
        // ReasoningBank, so `typeof ... === 'function'` was always false and this
        // branch was dead code — every write fell through to bridge-fallback while
        // `agentdb_controllers` cheerfully reported `reasoningBank: enabled=true`.
        //
        // Contract (agentdb ReasoningBank.d.ts):
        //   storePattern({ taskType, approach, successRate, uses?, avgReward?,
        //                  tags?, metadata? }) => Promise<number>   // sqlite rowid
        // The embedded text is `${taskType}: ${approach}`, so the caller's pattern
        // text must land in `approach` for search to match on it.
        if (reasoningBank && typeof reasoningBank.storePattern === 'function') {
            const rowId = await reasoningBank.storePattern({
                taskType: options.type,
                approach: options.pattern,
                successRate: options.confidence,
                tags: [options.type, 'reasoning-pattern'],
                metadata: options.metadata,
            });
            // storePattern returns a numeric rowid; surface it as the caller-facing
            // id so a later getPattern/deletePattern by this id resolves.
            return {
                success: true,
                patternId: rowId != null ? String(rowId) : patternId,
                controller: 'reasoningBank',
            };
        }
        // Fallback: store via bridge SQL
        const patternValue = JSON.stringify({ pattern: options.pattern, type: options.type, confidence: options.confidence, metadata: options.metadata });
        const result = await bridgeStoreEntry({
            key: patternId,
            value: patternValue,
            namespace: 'pattern',
            generateEmbeddingFlag: true,
            tags: [options.type, 'reasoning-pattern'],
            dbPath: options.dbPath,
        });
        if (!result)
            return null;
        // Add to HNSW index for fast semantic search (bridgeStoreEntry stores SQL only)
        if (result.rawEmbedding) {
            try {
                const { addToHNSWIndex } = await import('./memory-initializer.js');
                await addToHNSWIndex(result.id, result.rawEmbedding, {
                    id: result.id,
                    key: patternId,
                    namespace: 'pattern',
                    content: patternValue,
                });
            }
            catch { /* HNSW is best-effort */ }
        }
        // #3324: bridgeStoreEntry's `result.id` is its OWN internally generated
        // row id (generateId('entry')), a different value from the `key` the row
        // was actually stored under. getEntry/memory_retrieve look up by `key`,
        // so returning result.id here handed the caller a handle that can never
        // be read back — return `patternId` (the real key) instead.
        // #3325: say whether the row got a vector. Without one, Tier-1 (semantic)
        // pattern search cannot find it — report that here, at write time.
        return {
            success: true,
            patternId,
            controller: 'bridge-fallback',
            hasEmbedding: !!result.embedding,
            ...(result.embeddingError ? { embeddingError: result.embeddingError } : {}),
        };
    }
    catch (err) {
        // #3327 Finding A — this catch is what hid the defect for months. When
        // ReasoningBank threw `embedPassage is not a function`, the error was
        // discarded and the caller saw an ordinary fallback, indistinguishable
        // from "no controller registered". Record it so `agentdb_health` and the
        // degraded `reason` can name the real cause instead of guessing.
        bridgeFailureReasons.set(canonicalDbPath(options.dbPath), err instanceof Error ? err.message : String(err));
        return null;
    }
}
