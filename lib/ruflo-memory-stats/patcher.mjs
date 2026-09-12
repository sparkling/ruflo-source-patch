// ruvnet/ruflo#3311: statistics must use the CRUD registry's existing connection.
// Never relax the raw-WAL guard, open another driver, or close a borrowed handle.
export const STATS_DESCRIPTION_OLD = "        description: 'Get memory storage statistics including HNSW index status Use when native Read/Write is wrong because you need (a) cross-session retrieval by semantic similarity (vector embeddings) not by file path, (b) namespacing across projects without managing directory layout, or (c) the .swarm/memory.db audit trail. For one-shot file I/O, native Read/Write is fine.',";
export const STATS_DESCRIPTION_NEW = "        description: 'Get complete active memory-entry and embedding-presence counts through the existing AgentDB registry connection. Does not measure HNSW or semantic-search readiness; failures return unavailable counts, not an empty store.',";
export const STATS_PREFIX = `        name: 'memory_stats',
${STATS_DESCRIPTION_OLD}
        category: 'memory',
        inputSchema: {
            type: 'object',
            properties: {},
        },
`;
export const STATS_OLD = `        handler: async () => {
            await ensureInitialized();
            const { checkMemoryInitialization, listEntries } = await getMemoryFunctions();
            try {
                const status = await checkMemoryInitialization();
                const allEntries = await listEntries({ limit: 100000 });
                // Count by namespace
                const namespaces = {};
                let withEmbeddings = 0;
                for (const entry of allEntries.entries) {
                    namespaces[entry.namespace] = (namespaces[entry.namespace] || 0) + 1;
                    if (entry.hasEmbedding)
                        withEmbeddings++;
                }
                return {
                    initialized: status.initialized,
                    totalEntries: allEntries.total,
                    entriesWithEmbeddings: withEmbeddings,
                    embeddingCoverage: allEntries.total > 0
                        ? \`\${((withEmbeddings / allEntries.total) * 100).toFixed(1)}%\`
                        : '0%',
                    namespaces,
                    backend: await describeBackend(),
                    version: status.version || '3.0.0',
                    features: status.features || {
                        vectorEmbeddings: true,
                        hnswIndex: true,
                        semanticSearch: true,
                    },
                };
            }
            catch (error) {
                return {
                    initialized: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },`;

export const STATS_SQL = `SELECT COALESCE(NULLIF(namespace, ''), 'default') AS namespace,
                    COUNT(*) AS total,
                    SUM(CASE WHEN embedding IS NOT NULL
                        AND length(CAST(embedding AS TEXT)) > 10 THEN 1 ELSE 0 END) AS embedded
                FROM memory_entries
                WHERE status = 'active' OR status IS NULL
                GROUP BY COALESCE(NULLIF(namespace, ''), 'default')`;

export const STATS_NEW = `        handler: async () => {
            // ruflo-source-patch (#3311): no raw sql.js initialization probe.
            const reportingContract = 'registry-memory-stats-v1';
            try {
                const { getControllerRegistry } = await import('../memory/memory-bridge.js');
                const registry = await getControllerRegistry();
                const db = registry?.getAgentDB()?.database;
                if (!db || typeof db.prepare !== 'function')
                    throw new Error('AgentDB registry database unavailable; no fallback opened');
                // One aggregate statement uses the same snapshot and handle as CRUD.
                // Do not initialize/migrate schema, checkpoint, or close this handle.
                const rows = db.prepare(${JSON.stringify(STATS_SQL)}).all();
                if (!Array.isArray(rows)) throw new Error('Invalid memory statistics result');
                const namespaces = Object.create(null);
                let totalEntries = 0;
                let withEmbeddings = 0;
                for (const row of rows) {
                    if (!row || typeof row.namespace !== 'string'
                        || !Number.isSafeInteger(row.total) || row.total < 0
                        || !Number.isSafeInteger(row.embedded) || row.embedded < 0
                        || row.embedded > row.total
                        || Object.hasOwn(namespaces, row.namespace))
                        throw new Error('Invalid memory statistics aggregate');
                    namespaces[row.namespace] = row.total;
                    totalEntries += row.total;
                    withEmbeddings += row.embedded;
                }
                if (!Number.isSafeInteger(totalEntries) || !Number.isSafeInteger(withEmbeddings))
                    throw new Error('Memory statistics exceed safe integer range');
                return {
                    success: true,
                    initialized: true,
                    totalEntries,
                    entriesWithEmbeddings: withEmbeddings,
                    embeddingCoverage: totalEntries > 0
                        ? \`\${((withEmbeddings / totalEntries) * 100).toFixed(1)}%\` : '0%',
                    namespaces,
                    backend: 'AgentDB registry (existing connection)',
                    version: null,
                    features: { vectorEmbeddings: null, hnswIndex: null, semanticSearch: null },
                    scope: 'active and legacy-NULL memory entries; embedding presence, not index readiness',
                    reportingContract,
                };
            }
            catch (error) {
                return {
                    success: false,
                    initialized: null,
                    totalEntries: null,
                    entriesWithEmbeddings: null,
                    embeddingCoverage: null,
                    namespaces: null,
                    reportingContract,
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },`;

export const MEMORY_STATS_ENTRIES = [{
  id: 'ruflo-memory-stats/registry-read',
  target: 'ruflo-memory-stats',
  suffix: ['@claude-flow', 'cli', 'dist', 'src', 'mcp-tools', 'memory-tools.js'],
  edits: [
    // Exactly observed 3.38.21+/3.41.2 and 3.26–3.33 shapes. Both optional
    // invokes the engine's require-any guard: neither matching is a hard drift.
    ...[STATS_OLD, STATS_OLD.replace("backend: await describeBackend(),", "backend: 'sql.js + HNSW',")]
      .map(old => ({
        find: STATS_PREFIX + old,
        replace: STATS_PREFIX.replace(STATS_DESCRIPTION_OLD, STATS_DESCRIPTION_NEW) + STATS_NEW,
        optional: true,
      })),
  ],
}];
