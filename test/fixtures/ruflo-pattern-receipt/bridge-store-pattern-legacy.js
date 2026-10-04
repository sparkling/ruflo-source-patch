export async function bridgeStorePattern(options) {
    const registry = await getRegistry(options.dbPath);
    if (!registry)
        return null;
    try {
        const reasoningBank = registry.get('reasoningBank');
        const patternId = generateId('pattern');
        if (reasoningBank && typeof reasoningBank.store === 'function') {
            await reasoningBank.store({
                id: patternId,
                content: options.pattern,
                type: options.type,
                confidence: options.confidence,
                metadata: options.metadata,
                timestamp: Date.now(),
            });
            return { success: true, patternId, controller: 'reasoningBank' };
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
        return { success: true, patternId: result.id, controller: 'bridge-fallback' };
    }
    catch {
        return null;
    }
}
