// Native @claude-flow/cli3.71.1 describeBackend and non-smart result block.
async function describeBackend() {
    try {
        const { getHNSWStatus } = await import('../memory/memory-initializer.js');
        const status = getHNSWStatus();
        if (status.algorithm !== 'hnsw')
            return 'sqlite (bridge, brute-force cosine)';
        // #3228: with the native bridge gated off (the Windows default since
        // 3.38.12), memory tools silently fall back to the sql.js store rather
        // than the AgentDB corpus the bridge would have opened. A bare
        // "sql.js + HNSW" hides that substitution — an upgrade can change which
        // file receives writes while store/retrieve smoke tests still pass,
        // because both operations use the same unintended file. Name the gate.
        try {
            const { shouldDisableNativeBridge, getBridgeFailureReason } = await import('../memory/memory-bridge.js');
            if (shouldDisableNativeBridge()) {
                const reason = getBridgeFailureReason();
                return `sql.js + HNSW (native bridge disabled${reason ? `: ${reason}` : ''})`;
            }
        }
        catch {
            // bridge module unavailable — the plain sql.js label is already accurate
        }
        return 'sql.js + HNSW';
    }
    catch {
        return 'sqlite';
    }
}

export async function report({ results, query, thresholdWasDefault, namespace, provenanceFilter, dbPath, duration, smartFallbackReason, nearMisses, searchEntries }) {
                const nearMissInfo = results.length === 0 && thresholdWasDefault
                    ? await nearMisses(searchEntries, { query, namespace, provenanceFilter, dbPath })
                    : undefined;
                return {
                    query,
                    results,
                    total: results.length,
                    ...(nearMissInfo ?? {}),
                    searchTime: `${duration.toFixed(2)}ms`,
                    backend: 'HNSW + sql.js',
                    ...(smartFallbackReason ? { smartFallback: smartFallbackReason } : {}),
                };
}
