{
        name: 'memory_search_unified',
        description: 'Search across both Claude Code memories and AgentDB entries using semantic vector similarity. Returns merged, deduplicated results from all namespaces. Use when native Read/Write is wrong because you need (a) cross-session retrieval by semantic similarity (vector embeddings) not by file path, (b) namespacing across projects without managing directory layout, or (c) the .swarm/memory.db audit trail. For one-shot file I/O, native Read/Write is fine.',
        category: 'memory',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search query (natural language)' },
                limit: { type: 'number', description: 'Max results (default: 10)' },
                namespace: { type: 'string', description: 'Filter to a single namespace (mutually exclusive with `namespaces`)' },
                namespaces: { type: 'array', items: { type: 'string' }, description: 'Explicit list of namespaces to fan out across (overrides defaults and env)' },
            },
            required: ['query'],
        },
        handler: async (input) => {
            const missingQuery = missingRequiredString(input, 'query', 'memory_search_unified');
            if (missingQuery) {
                return { success: false, query: input.query, results: [], total: 0, ...missingQuery };
            }
            await ensureInitialized();
            const { searchEntries, listEntries } = await getMemoryFunctions();
            validateMemoryInput(undefined, undefined, input.query);
            const query = input.query;
            const limit = input.limit ?? 10;
            const ns = input.namespace;
            const nsList = Array.isArray(input.namespaces) ? input.namespaces : undefined;
            if (ns) {
                const vNs = validateIdentifier(ns, 'namespace');
                if (!vNs.valid)
                    return { success: false, query, results: [], total: 0, error: vNs.error };
            }
            if (nsList) {
                for (const n of nsList) {
                    const v = validateIdentifier(n, 'namespaces[]');
                    if (!v.valid)
                        return { success: false, query, results: [], total: 0, error: v.error };
                }
            }
            // #2246 fix: namespace resolution priority is
            //   1. explicit single `namespace` (back-compat)
            //   2. explicit `namespaces: string[]` (new in 3.10.29)
            //   3. env var CLAUDE_FLOW_MEMORY_SEARCH_NAMESPACES (CSV)
            //   4. dynamic enumeration via listEntries({}) over the actual store
            //   5. legacy 6-namespace hardcode as last-resort fallback
            // The legacy default was silently missing ~95% of entries on stores with
            // custom namespaces (issue #2246). Dynamic enumeration fixes that.
            const LEGACY_DEFAULT = ['default', 'claude-memories', 'auto-memory', 'patterns', 'tasks', 'feedback'];
            let namespaces;
            let namespaceSource;
            if (ns) {
                namespaces = [ns];
                namespaceSource = 'param-single';
            }
            else if (nsList && nsList.length > 0) {
                namespaces = nsList;
                namespaceSource = 'param-list';
            }
            else if (process.env.CLAUDE_FLOW_MEMORY_SEARCH_NAMESPACES) {
                namespaces = process.env.CLAUDE_FLOW_MEMORY_SEARCH_NAMESPACES.split(',').map(s => s.trim()).filter(Boolean);
                namespaceSource = 'env';
            }
            else {
                // Dynamic enumeration — list all entries and collect distinct namespaces.
                // Cap entries at 100k to bound memory; in practice this is fast (<200ms).
                try {
                    const all = await listEntries({ limit: 100000 });
                    const seenNs = new Set();
                    for (const e of all?.entries ?? [])
                        if (e.namespace)
                            seenNs.add(e.namespace);
                    namespaces = seenNs.size > 0 ? Array.from(seenNs).sort() : LEGACY_DEFAULT;
                    namespaceSource = seenNs.size > 0 ? 'dynamic' : 'legacy-fallback';
                }
                catch {
                    namespaces = LEGACY_DEFAULT;
                    namespaceSource = 'legacy-fallback';
                }
            }
            const allResults = [];
            for (const searchNs of namespaces) {
                try {
                    const r = await searchEntries({ query, namespace: searchNs, limit: limit * 2 });
                    if (r?.results) {
                        for (const entry of r.results) {
                            allResults.push({
                                key: entry.key || entry.id || '',
                                content: (entry.content || entry.value || '').toString().slice(0, 200),
                                score: entry.score || 0,
                                namespace: searchNs,
                                source: searchNs === 'claude-memories' ? 'claude-code' : searchNs === 'auto-memory' ? 'auto-memory' : 'agentdb',
                            });
                        }
                    }
                }
                catch { /* namespace may not exist */ }
            }
            // Sort by score, deduplicate by (namespace, key), take top N. An entry is
            // identified by both (see #2271), so the same key in another namespace is
            // a different entry and must not be dropped as a duplicate.
            allResults.sort((a, b) => b.score - a.score);
            const seen = new Set();
            const deduplicated = allResults.filter(r => {
                const id = JSON.stringify([r.namespace, r.key]);
                if (seen.has(id))
                    return false;
                seen.add(id);
                return true;
            }).slice(0, limit);
            return {
                success: true,
                query,
                results: deduplicated,
                total: deduplicated.length,
                searchedNamespaces: namespaces,
                namespaceSource, // #2246 — surface how the namespace list was resolved
                searchTime: Date.now(),
            };
        },
    }
