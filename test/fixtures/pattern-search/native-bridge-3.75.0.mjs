// Exact published @claude-flow/cli 3.75.0 functions; isolated readers.
/**
 * Case-insensitive substring match over agentdb's reasoning_patterns table —
 * the rows ReasoningBank.storePattern() writes. Used only when the vector
 * search returns nothing. Returns no rows (and no error) when there is no
 * database handle to scan.
 *
 * #4714: a read that throws is reported through `error`, not turned into an
 * empty list. The pattern-search handler reports an error-free empty result
 * as a healthy no-match, so a SQL failure must not look like one.
 */
function substringSearchReasoningPatterns(registry, query, k) {
    const db = registry?.getAgentDB?.()?.database;
    if (!db || typeof db.prepare !== 'function')
        return { rows: [] };
    try {
        const like = `%${query.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        const rows = db.prepare("SELECT id, approach, success_rate FROM reasoning_patterns WHERE lower(approach) LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT ?").all(like, k);
        return { rows: rows.map((r) => ({ id: String(r.id), content: r.approach, score: r.success_rate ?? 0 })) };
    }
    catch (err) {
        return { rows: [], error: `reasoning_patterns substring scan failed: ${err instanceof Error ? err.message : String(err)}` };
    }
}
/**
 * Search patterns via ReasoningBank controller.
 *
 * Returns null when no registry is available. With `controller:
 * 'reasoningBank'`, an empty `results` and no `error` means the controller
 * ran and found nothing. #4714: when the controller throws, returns a
 * non-array, or the substring scan fails, the result carries `error` so the
 * caller cannot mistake the failure for a no-match.
 */
export async function bridgeSearchPatterns(options) {
    if (!operationContext.getStore()?.active)
        return withBridgeOperation(() => bridgeSearchPatterns(options));
    const registry = await getRegistry(options.dbPath);
    if (!registry)
        return null;
    try {
        const reasoningBank = registry.get('reasoningBank');
        // ReasoningBank may expose .searchPatterns() (agentdb) or .search() (legacy) (#1492 Bug 2)
        if (reasoningBank && typeof (reasoningBank.searchPatterns ?? reasoningBank.search) === 'function') {
            let results;
            try {
                if (typeof reasoningBank.searchPatterns === 'function') {
                    results = await reasoningBank.searchPatterns({ task: options.query, k: options.topK || 5, threshold: options.minConfidence || 0.3 });
                }
                else {
                    results = await reasoningBank.search(options.query, { topK: options.topK || 5, minScore: options.minConfidence || 0.3 });
                }
            }
            catch (err) {
                // #4714 — report the failure with the result instead of a bare null,
                // which callers read as "no registry". Still recorded for agentdb_health.
                const message = err instanceof Error ? err.message : String(err);
                bridgeFailureReasons.set(canonicalDbPath(options.dbPath), message);
                return { results: [], controller: 'reasoningBank', error: `ReasoningBank search failed: ${message}` };
            }
            if (!Array.isArray(results)) {
                return {
                    results: [],
                    controller: 'reasoningBank',
                    error: `ReasoningBank search returned a non-array result (${results === null ? 'null' : typeof results})`,
                };
            }
            // #3327 Finding A — agentdb returns ReasoningPattern[]: the text lives in
            // `approach` and the cosine score in `similarity`. Neither `content`/
            // `pattern` nor `score`/`confidence` exists on that shape, so the old
            // mapping produced `content: ''` and `score: 0` for every hit even when
            // the search itself succeeded. Read the real fields first, keeping the
            // legacy names as fallbacks for the pre-agentdb shape.
            const mapped = results.map((r) => ({
                id: String(r.id ?? r.patternId ?? ''),
                content: r.approach ?? r.content ?? r.pattern ?? '',
                score: r.similarity ?? r.score ?? r.successRate ?? r.confidence ?? 0,
            }));
            if (mapped.length > 0)
                return { results: mapped, controller: 'reasoningBank' };
            // #4643 — with agentdb's mock embedder (Transformers.js failed to load:
            // offline, or a failed `sharp` install) a passage and a query embed to
            // unrelated hash vectors, so the vector search misses a pattern that
            // storePattern just wrote. Scan the same reasoning_patterns table for the
            // query text, as the LocalReasoningBank branch below does over getAll().
            const scan = substringSearchReasoningPatterns(registry, options.query, options.topK || 5);
            return scan.error
                ? { results: scan.rows, controller: 'reasoningBank', error: scan.error }
                : { results: scan.rows, controller: 'reasoningBank' };
        }
        // #2226 — the wired-in LocalReasoningBank implements store() + findSimilar()/getAll()
        // but NOT searchPatterns()/search(). bridgeStorePattern commits patterns to its
        // store(), so search MUST read the SAME backend or stored patterns are never found
        // (previously search fell through to the disjoint sql.js 'pattern' namespace, which
        // the store never wrote to → always-empty results). Adapt findSimilar (semantic) with
        // a getAll() substring fallback so freshly-stored patterns are visible. This mirrors
        // what hooks_intelligence_pattern-search already does against the same backend.
        if (reasoningBank && typeof reasoningBank.findSimilar === 'function') {
            const k = options.topK || 5;
            const threshold = options.minConfidence ?? 0.3;
            let mapped = [];
            try {
                const { generateEmbedding } = await import('./memory-initializer.js');
                const qEmb = await generateEmbedding(options.query);
                if (qEmb && Array.isArray(qEmb.embedding) && qEmb.embedding.length > 0) {
                    const hits = reasoningBank.findSimilar(qEmb.embedding, { k, threshold });
                    // findSimilar() no longer overwrites confidence with the query-match
                    // score — prefer similarity (the actual match strength) for search ranking,
                    // falling back to confidence/score only for older/foreign result shapes.
                    mapped = (Array.isArray(hits) ? hits : []).map((r) => ({
                        id: r.id ?? '',
                        content: r.content ?? '',
                        score: r.similarity ?? r.confidence ?? r.score ?? 0,
                    }));
                }
            }
            catch { /* embedding unavailable — fall through to substring scan */ }
            // Deterministic substring fallback over the same in-memory store.
            if (mapped.length === 0 && typeof reasoningBank.getAll === 'function') {
                const q = options.query.toLowerCase();
                mapped = reasoningBank.getAll()
                    .filter((p) => typeof p.content === 'string' && p.content.toLowerCase().includes(q))
                    .slice(0, k)
                    .map((p) => ({ id: p.id ?? '', content: p.content ?? '', score: p.confidence ?? 0 }));
            }
            // Nothing in the bank: patterns written by the SQL fallback path (before
            // the bank was registered, or by a process without it) live in the
            // `pattern` namespace, so search that instead of returning empty.
            if (mapped.length > 0)
                return { results: mapped, controller: 'reasoningBank' };
        }
        // Fallback: search via bridge
        const result = await bridgeSearchEntries({
            query: options.query,
            namespace: 'pattern',
            limit: options.topK || 5,
            threshold: options.minConfidence || 0.3,
            dbPath: options.dbPath,
        });
        return result ? {
            results: result.results.map(r => ({ id: r.id, content: r.content, score: r.score })),
            controller: 'bridge-fallback',
        } : null;
    }
    catch (err) {
        // #3327 Finding A — see bridgeStorePattern's catch. `embedQuery is not a
        // function` died here silently, which is why search reported
        // `reasoningBank-unavailable:registry-null` (a null return) even though
        // the registry was present and the controller was reported enabled.
        bridgeFailureReasons.set(canonicalDbPath(options.dbPath), err instanceof Error ? err.message : String(err));
        return null;
    }
}
// ===== Phase 3: Feedback recording =====
