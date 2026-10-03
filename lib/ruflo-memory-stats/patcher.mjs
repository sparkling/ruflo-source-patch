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

// Ruflo 3.42.4 fixes the false "uninitialized" result but still enumerates the
// entire store and advertises feature/version labels that the listing cannot prove.
// Preserve the exact published shape as a second fail-closed anchor.
export const STATS_342 = `        handler: async () => {
            await ensureInitialized();
            const { listEntries } = await getMemoryFunctions();
            // #3311: the store's own listing decides whether memory is there.
            // \`checkMemoryInitialization\` opens a whole-image sql.js snapshot of
            // the main database file, which cannot include live SQLite WAL frames
            // — so a store the bridge reads and searches perfectly well came back
            // \`initialized: false\` from this tool alone. The probe is still read
            // below, for the version and feature labels it is the only source of,
            // but it no longer gets to overrule a working store.
            let listing;
            try {
                listing = await collectAllEntries(listEntries);
            }
            catch (error) {
                return memoryStatsUnavailable(error instanceof Error ? error.message : 'Unknown error');
            }
            if (!listing.success) {
                // A failed query is not an empty store. Reporting zeros here is
                // what made a WAL refusal look like "you have no memories".
                return memoryStatsUnavailable(listing.error || 'listEntries reported failure');
            }
            // Object.create(null): a namespace literally named \`__proto__\` is a
            // legal key, and assigning it on an object literal sets the prototype
            // instead of counting anything — so that namespace's entries vanished
            // from the breakdown while still being counted in the total.
            const namespaces = Object.create(null);
            let withEmbeddings = 0;
            for (const entry of listing.entries) {
                namespaces[entry.namespace] = (namespaces[entry.namespace] || 0) + 1;
                if (entry.hasEmbedding)
                    withEmbeddings++;
            }
            const counted = listing.entries.length;
            const status = await readMemoryStatusLabels();
            return {
                initialized: true,
                totalEntries: listing.total,
                entriesCounted: counted,
                // The breakdown below covers \`entriesCounted\` rows, which is every
                // row unless the listing was truncated; say so rather than letting
                // a partial count read as the whole store.
                ...(counted < listing.total ? { truncated: true } : {}),
                entriesWithEmbeddings: withEmbeddings,
                embeddingCoverage: counted > 0
                    ? \`\${((withEmbeddings / counted) * 100).toFixed(1)}%\`
                    : '0%',
                namespaces: { ...namespaces },
                backend: await describeBackend(),
                version: status.version || '3.0.0',
                features: status.features || {
                    vectorEmbeddings: true,
                    hnswIndex: true,
                    semanticSearch: true,
                },
            };
        },`;

export const STATS_351 = "        name: 'memory_stats',\n        description: 'Get memory storage statistics including HNSW index status Use when native Read/Write is wrong because you need (a) cross-session retrieval by semantic similarity (vector embeddings) not by file path, (b) namespacing across projects without managing directory layout, or (c) the .swarm/memory.db audit trail. For one-shot file I/O, native Read/Write is fine.',\n        category: 'memory',\n        inputSchema: {\n            type: 'object',\n            properties: {\n                dbPath: { type: 'string', description: 'Database file to inspect; omitted uses the MCP store default' },\n            },\n        },\n        handler: async (input) => {\n            if (input.dbPath !== undefined && (typeof input.dbPath !== 'string' || !input.dbPath.trim())) {\n                return memoryStatsUnavailable('dbPath must be a non-empty string');\n            }\n            const dbPath = typeof input.dbPath === 'string' ? resolve(input.dbPath) : undefined;\n            // An explicit read must not initialize or migrate the unrelated default store.\n            if (!dbPath)\n                await ensureInitialized();\n            const { listEntries } = await getMemoryFunctions();\n            // #3311: the store's own listing decides whether memory is there.\n            // `checkMemoryInitialization` opens a whole-image sql.js snapshot of\n            // the main database file, which cannot include live SQLite WAL frames\n            // \u2014 so a store the bridge reads and searches perfectly well came back\n            // `initialized: false` from this tool alone. The probe is still read\n            // below, for the version and feature labels it is the only source of,\n            // but it no longer gets to overrule a working store.\n            let listing;\n            try {\n                listing = await collectAllEntries(listEntries, dbPath);\n            }\n            catch (error) {\n                return memoryStatsUnavailable(error instanceof Error ? error.message : 'Unknown error');\n            }\n            if (!listing.success) {\n                // A failed query is not an empty store. Reporting zeros here is\n                // what made a WAL refusal look like \"you have no memories\".\n                return memoryStatsUnavailable(listing.error || 'listEntries reported failure');\n            }\n            // Object.create(null): a namespace literally named `__proto__` is a\n            // legal key, and assigning it on an object literal sets the prototype\n            // instead of counting anything \u2014 so that namespace's entries vanished\n            // from the breakdown while still being counted in the total.\n            const namespaces = Object.create(null);\n            let withEmbeddings = 0;\n            let oldest = Infinity;\n            let newest = -Infinity;\n            for (const entry of listing.entries) {\n                namespaces[entry.namespace] = (namespaces[entry.namespace] || 0) + 1;\n                if (entry.hasEmbedding)\n                    withEmbeddings++;\n                // AgentDB returns INTEGER epoch milliseconds; legacy sql.js rows\n                // may expose ISO strings or numeric strings from SQLite TEXT affinity.\n                const rawCreated = entry.createdAt;\n                const millis = typeof rawCreated === 'number'\n                    ? rawCreated\n                    : typeof rawCreated === 'string' && /^-?\\d+$/.test(rawCreated)\n                        ? Number(rawCreated)\n                        : Date.parse(rawCreated ?? '');\n                const created = new Date(millis).getTime();\n                if (Number.isFinite(created)) {\n                    oldest = Math.min(oldest, created);\n                    newest = Math.max(newest, created);\n                }\n            }\n            const counted = listing.entries.length;\n            const status = await readMemoryStatusLabels(dbPath);\n            let totalSize = null;\n            if (dbPath) {\n                try {\n                    let bytes = statSync(dbPath).size;\n                    try {\n                        bytes += statSync(dbPath + '-wal').size;\n                    }\n                    catch (error) {\n                        if (error.code !== 'ENOENT')\n                            throw error;\n                    }\n                    totalSize = `${bytes} B`;\n                }\n                catch { /* unavailable file metadata is unknown, not zero */ }\n            }\n            return {\n                initialized: true,\n                totalEntries: listing.total,\n                ...(dbPath ? { location: dbPath, totalSize } : {}),\n                oldestEntry: counted >= listing.total && Number.isFinite(oldest) ? new Date(oldest).toISOString() : null,\n                newestEntry: counted >= listing.total && Number.isFinite(newest) ? new Date(newest).toISOString() : null,\n                entriesCounted: counted,\n                // The breakdown below covers `entriesCounted` rows, which is every\n                // row unless the listing was truncated; say so rather than letting\n                // a partial count read as the whole store.\n                ...(counted < listing.total ? { truncated: true } : {}),\n                entriesWithEmbeddings: withEmbeddings,\n                embeddingCoverage: counted > 0\n                    ? `${((withEmbeddings / counted) * 100).toFixed(1)}%`\n                    : '0%',\n                namespaces: { ...namespaces },\n                backend: await describeBackend(),\n                version: status.version || '3.0.0',\n                features: status.features || {\n                    vectorEmbeddings: true,\n                    hnswIndex: true,\n                    semanticSearch: true,\n                },\n            };\n        },";

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

// Match the native JavaScript date normalization without enumerating records:
// epoch milliseconds, numeric strings and ISO timestamps share one SQL snapshot.
const CREATED_MILLIS_RAW_SQL = `CASE
    WHEN typeof(created_at) IN ('integer', 'real') THEN created_at
    WHEN typeof(created_at) = 'text' AND length(created_at) > 0 AND
        (created_at NOT GLOB '*[^0-9]*' OR
            (substr(created_at, 1, 1) = '-' AND length(created_at) > 1
                AND substr(created_at, 2) NOT GLOB '*[^0-9]*'))
        THEN CAST(created_at AS INTEGER)
    ELSE CAST(strftime('%s', created_at) AS INTEGER) * 1000
        + CAST(substr(strftime('%f', created_at), 4, 3) AS INTEGER)
    END`;
const CREATED_MILLIS_SQL = `CASE WHEN (${CREATED_MILLIS_RAW_SQL}) BETWEEN -8640000000000000 AND 8640000000000000
    THEN (${CREATED_MILLIS_RAW_SQL}) ELSE NULL END`;
export const STATS_351_SQL = STATS_SQL.replace('COUNT(*) AS total,',
  `COUNT(*) AS total,
                    MIN(${CREATED_MILLIS_SQL}) AS oldest,
                    MAX(${CREATED_MILLIS_SQL}) AS newest,`);

export const STATS_351_NEW = STATS_NEW
  .replace('handler: async () => {', 'handler: async (input = {}) => {')
  .replace("            try {", `            try {
                if (input.dbPath !== undefined && (typeof input.dbPath !== 'string' || !input.dbPath.trim()))
                    throw new Error('dbPath must be a non-empty string');
                const dbPath = typeof input.dbPath === 'string' ? resolve(input.dbPath) : undefined;`)
  .replace('await getControllerRegistry();', 'await getControllerRegistry(dbPath);')
  .replace(JSON.stringify(STATS_SQL), JSON.stringify(STATS_351_SQL))
  .replace('                let totalEntries = 0;', `                let oldest = Infinity;
                let newest = -Infinity;
                let totalEntries = 0;`)
  .replace('                    namespaces[row.namespace] = row.total;', `                    if (Number.isFinite(row.oldest) && Math.abs(row.oldest) <= 8640000000000000)
                        oldest = Math.min(oldest, row.oldest);
                    if (Number.isFinite(row.newest) && Math.abs(row.newest) <= 8640000000000000)
                        newest = Math.max(newest, row.newest);
                    namespaces[row.namespace] = row.total;`)
  .replace('                return {\n                    success: true,', `                let totalSize = null;
                if (dbPath) {
                    try { totalSize = statSync(dbPath).size; } catch { /* unknown metadata stays null */ }
                }
                return {
                    success: true,`)
  .replace("                    namespaces,", `                    namespaces,
                    ...(dbPath ? { location: dbPath, totalSize } : {}),
                    oldestEntry: Number.isFinite(oldest) ? new Date(oldest).toISOString() : null,
                    newestEntry: Number.isFinite(newest) ? new Date(newest).toISOString() : null,`);

export const MEMORY_STATS_ENTRIES = [{
  id: 'ruflo-memory-stats/registry-read',
  target: 'ruflo-memory-stats',
  suffix: ['@claude-flow', 'cli', 'dist', 'src', 'mcp-tools', 'memory-tools.js'],
  edits: [
    { find: STATS_351, replace: STATS_351.slice(0, STATS_351.indexOf('        handler:'))
      .replace(STATS_DESCRIPTION_OLD, STATS_DESCRIPTION_NEW) + STATS_351_NEW, optional: true },
    // Exactly observed 3.38.21+/3.41.2 and 3.26–3.33 shapes. Both optional
    // invokes the engine's require-any guard: neither matching is a hard drift.
    ...[STATS_OLD, STATS_OLD.replace("backend: await describeBackend(),", "backend: 'sql.js + HNSW',"), STATS_342]
      .map(old => ({
        find: STATS_PREFIX + old,
        replace: STATS_PREFIX.replace(STATS_DESCRIPTION_OLD, STATS_DESCRIPTION_NEW) + STATS_NEW,
        optional: true,
      })),
  ],
}];
