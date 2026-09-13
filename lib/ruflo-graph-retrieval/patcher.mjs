// ruvnet/ruflo#3315: a separately populated native graph is not a complete
// view of retained graph_edges. Reuse the existing SQL reader; never replay data.
export const QUERY_DESCRIPTION_OLD = "    description: 'Unified graph traversal across the knowledge graph (ADR-130). Dispatches to the most capable backend: graph-node native for k-hop, sql.js CTE for fallback, HNSW cosine for semantic, ruflo-graph-intelligence PageRank for pagerank mode. Use when you need structured graph traversal beyond flat memory search.',";
export const QUERY_DESCRIPTION_NEW = "    description: 'Unified graph traversal (ADR-130). K-hop reads retained graph_edges through the managed SQL reader, with relation filtering, outgoing edges, seed exclusion and an explicitly reported maximum depth of 3. Native graph contents are not used as proof of retained history. Other modes are unchanged.',";
export const DEPTH_OLD = "            depth: { type: 'number', description: 'Hop depth for k-hop mode (default 2, max 5)' },";
export const DEPTH_NEW = "            depth: { type: 'number', description: 'Requested k-hop depth (default 2); SQL applies at most 3 and reports depthLimited' },";
export const BUDGET_OLD = "                description: 'Computation limits',";
export const BUDGET_NEW = "                description: 'K-hop enforces depth and returned-row limits only; work, time and memory bounds are not enforced',";
export const QUERY_OLD = `            if (mode === 'k-hop') {
                // Try graph-node native first
                try {
                    const graphBackend = await getGraphBackend();
                    if (await graphBackend.isGraphBackendAvailable()) {
                        const neighbors = await graphBackend.getNeighbors(nodeId, depth);
                        return {
                            success: true, mode, nodeId, depth,
                            results: neighbors.map(id => ({ nodeId: id })),
                            count: neighbors.length,
                            backend: 'graph-node',
                            elapsedMs: Date.now() - t0,
                        };
                    }
                }
                catch { /* fall through to sql.js */ }
                // SQL CTE fallback for k-hop up to depth 3
                try {
                    const { getBridgeDb } = await getGraphEdgeWriter();
                    const db = await getBridgeDb();
                    if (db) {
                        const cteSql = buildKHopCTE(nodeId, Math.min(depth, 3), relation, budget.maxNodesVisited);
                        // graph-edge-writer returns a better-sqlite3 Database after #2431.
                        // \`db.exec(sql, params)\` (sql.js style) is a runner with no result
                        // on better-sqlite3 — use \`prepare(sql).raw().all(...)\` to get the
                        // same array-of-arrays shape the downstream code expects.
                        const rows = db.prepare(cteSql).raw().all();
                        return {
                            success: true, mode, nodeId, depth,
                            results: rows.map((r) => ({ nodeId: r[0], depth: r[1] })),
                            count: rows.length,
                            backend: 'sql-cte',
                            elapsedMs: Date.now() - t0,
                        };
                    }
                }
                catch { /* db unavailable */ }
                return { success: false, error: 'No graph backend available for k-hop query', mode, nodeId };
            }`;

export const QUERY_NEW = `            if (mode === 'k-hop') {
                // ruflo-source-patch #3315: native availability is not coverage.
                const retrievalContract = 'retained-sql-khop-v1';
                try {
                    const bound = (value, fallback, cap) => {
                        if (value === undefined) return fallback;
                        if (!Number.isSafeInteger(value) || value < 1)
                            throw new Error('Graph depth and node limits must be positive safe integers');
                        return Math.min(value, cap);
                    };
                    const requestedDepth = bound(params.depth, 2, Number.MAX_SAFE_INTEGER);
                    const appliedDepth = Math.min(requestedDepth, bound(budgetRaw.maxDepth, 5, 5), 3);
                    const resultLimit = bound(budgetRaw.maxNodesVisited, 10000, 10000);
                    if (params.relation !== undefined && (typeof params.relation !== 'string'
                        || !params.relation.length || params.relation.length > 200))
                        throw new Error('relation must be a non-empty string of at most 200 characters');
                    // Match the existing causal-edge writer's SQL ID mapping.
                    const resolved = ensureDomainPrefix(nodeId);
                    const { getBridgeDb } = await getGraphEdgeWriter();
                    const db = await getBridgeDb();
                    if (!db || typeof db.prepare !== 'function')
                        throw new Error('Retained SQL graph unavailable; native coverage is unverified');
                    // Existing escaped CTE/accessor (which may ensure schema).
                    // No import, replay, custom driver, or mutation of graph rows.
                    const rows = db.prepare(buildKHopCTE(resolved.id, appliedDepth, relation, resultLimit + 1)).raw().all();
                    if (!Array.isArray(rows) || rows.some(row => !Array.isArray(row)
                        || typeof row[0] !== 'string' || !Number.isInteger(row[1])
                        || row[1] < 1 || row[1] > appliedDepth || row[0] === resolved.id))
                        throw new Error('Invalid retained graph query result');
                    const resultLimitReached = rows.length > resultLimit;
                    const results = rows.slice(0, resultLimit).map(row => ({nodeId: row[0], depth: row[1]}));
                    return {
                        success: true, mode, nodeId, depth: appliedDepth, requestedDepth,
                        results, count: results.length, backend: 'sql-cte', retrievalContract,
                        resolvedNodeId: resolved.id, legacyIdMapped: resolved.wasLegacy,
                        scope: 'committed graph_edges; pending or failed SQL writes are not covered',
                        direction: 'outgoing', seedIncluded: false,
                        truncated: appliedDepth < requestedDepth || resultLimitReached,
                        depthLimited: appliedDepth < requestedDepth, resultLimitReached,
                        resultLimit, budgetScope: 'depth and returned rows only; traversal work, time and memory are not bounded',
                        elapsedMs: Date.now() - t0,
                    };
                } catch (error) {
                    return { success: false, mode, nodeId, backend: 'sql-cte', retrievalContract,
                        count: null, results: null, error: sanitizeError(error) };
                }
            }`;

export const GRAPH_RETRIEVAL_ENTRIES = [{
  id: 'ruflo-graph-retrieval/retained-sql-khop', target: 'ruflo-graph-retrieval',
  suffix: ['@claude-flow', 'cli', 'dist', 'src', 'mcp-tools', 'agentdb-tools.js'],
  edits: [
    { find: QUERY_DESCRIPTION_OLD, replace: QUERY_DESCRIPTION_NEW },
    { find: DEPTH_OLD, replace: DEPTH_NEW },
    { find: BUDGET_OLD, replace: BUDGET_NEW },
    { find: QUERY_OLD, replace: QUERY_NEW },
  ],
}];
