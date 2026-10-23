// Exact published memory_stats block; preserve upstream explicit/default binding (#3311).
export const STATS_35917 = `        name: 'memory_stats',
        description: 'Get memory storage statistics including HNSW index status Use when native Read/Write is wrong because you need (a) cross-session retrieval by semantic similarity (vector embeddings) not by file path, (b) namespacing across projects without managing directory layout, or (c) the .swarm/memory.db audit trail. For one-shot file I/O, native Read/Write is fine.',
        category: 'memory',
        inputSchema: {
            type: 'object',
            properties: {
                dbPath: { type: 'string', description: 'Explicit SQLite store to read/write; omit to use the MCP default (the native/AgentDB sibling).' },
            },
        },
        handler: async (input) => {
            if (input.dbPath !== undefined && (typeof input.dbPath !== 'string' || !input.dbPath.trim())) {
                return memoryStatsUnavailable('dbPath must be a non-empty string');
            }
            const dbPath = resolveDbPathOption(input.dbPath);
            // An explicit read must not initialize or migrate the unrelated default store.
            if (!dbPath)
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
                listing = await collectAllEntries(listEntries, dbPath);
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
            let oldest = Infinity;
            let newest = -Infinity;
            for (const entry of listing.entries) {
                namespaces[entry.namespace] = (namespaces[entry.namespace] || 0) + 1;
                if (entry.hasEmbedding)
                    withEmbeddings++;
                // AgentDB returns INTEGER epoch milliseconds; legacy sql.js rows
                // may expose ISO strings or numeric strings from SQLite TEXT affinity.
                const rawCreated = entry.createdAt;
                const millis = typeof rawCreated === 'number'
                    ? rawCreated
                    : typeof rawCreated === 'string' && /^-?\\d+$/.test(rawCreated)
                        ? Number(rawCreated)
                        : Date.parse(rawCreated ?? '');
                const created = new Date(millis).getTime();
                if (Number.isFinite(created)) {
                    oldest = Math.min(oldest, created);
                    newest = Math.max(newest, created);
                }
            }
            const counted = listing.entries.length;
            const status = await readMemoryStatusLabels(dbPath);
            let totalSize = null;
            if (dbPath) {
                try {
                    let bytes = statSync(dbPath).size;
                    try {
                        bytes += statSync(dbPath + '-wal').size;
                    }
                    catch (error) {
                        if (error.code !== 'ENOENT')
                            throw error;
                    }
                    totalSize = \`\${bytes} B\`;
                }
                catch { /* unavailable file metadata is unknown, not zero */ }
            }
            return {
                initialized: true,
                totalEntries: listing.total,
                ...(dbPath ? { location: dbPath, totalSize } : {}),
                oldestEntry: counted >= listing.total && Number.isFinite(oldest) ? new Date(oldest).toISOString() : null,
                newestEntry: counted >= listing.total && Number.isFinite(newest) ? new Date(newest).toISOString() : null,
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
