// Exact search sections from @claude-flow/cli 3.71.1; dependency injection in tests only.
export const agentdbPatternSearch = {
    name: 'agentdb_pattern-search',
    description: 'Search patterns via ReasoningBank controller with BM25+semantic hybrid Use when generic memory_* tools are wrong because you need AgentDB-specific controllers (HNSW vector search, hierarchical tiers, causal-graph links, pattern store/recall, RaBitQ quantization). For simple key-value persistence, memory_store/memory_retrieve are simpler. For unrelated file work, native Read/Write are fine.',
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'Search query' },
            topK: { type: 'number', description: 'Number of results (default: 5)' },
            minConfidence: { type: 'number', description: 'Minimum score threshold (0-1)' },
        },
        required: ['query'],
    },
    handler: async (params) => {
        try {
            const vQuery = validateText(params.query, 'query', 10_000);
            if (!vQuery.valid)
                return { results: [], error: vQuery.error };
            const query = validateString(params.query, 'query', 10_000);
            if (!query)
                return { results: [], error: 'query is required (non-empty string, max 10KB)' };
            const topK = validatePositiveInt(params.topK, 5, MAX_TOP_K);
            const minConfidence = validateScore(params.minConfidence, 0.3);
            const bridge = await getBridge();
            const result = await bridge.bridgeSearchPatterns({ query, topK, minConfidence });
            if (result && Array.isArray(result.results) && result.results.length > 0) {
                // #3288: `controller: 'reasoningBank'` is the only label meaning the
                // healthy path ran and actually found results. Any other label
                // (`bridge-fallback` today; more may be added later) is a degraded
                // response even though it has results — flag it here, since this
                // early return bypasses the tier1/tier2 fallback block below
                // entirely (and its degraded:true) whenever there ARE results.
                if (result.controller === 'reasoningBank')
                    return result;
                return {
                    ...result,
                    degraded: true,
                    reason: `reasoningBank-unavailable:${result.controller}`,
                    note: `ReasoningBank controller unavailable (controller=${result.controller}); results returned via the fallback path. Run \`agentdb_health\` to inspect controller registration.`,
                };
            }
            // #1889 — symmetric fallback. pattern-store writes to the `pattern`
            // namespace via memory_store when ReasoningBank is unavailable; the
            // search path used to return an empty list with `controller: 'unavailable'`
            // even though the user's pattern was sitting in that namespace. We now
            // tier the fallback so freshly-written entries are findable before HNSW
            // catches up:
            //   1. Try semantic search via searchEntries (HNSW-backed)
            //   2. If that returns 0, list the namespace and substring-match the query
            //      against each entry's pattern text. Deterministic; survives
            //      embedding-index latency and threshold tuning.
            try {
                const { searchEntries, listEntries, getEntry } = await import('../memory/memory-initializer.js');
                const parseEntry = (e) => {
                    const raw = typeof e.content === 'string' ? e.content : e.value;
                    if (typeof raw !== 'string')
                        return null;
                    try {
                        const parsed = JSON.parse(raw);
                        const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.8;
                        if (confidence < minConfidence)
                            return null;
                        return {
                            patternId: e.key ?? e.id,
                            pattern: parsed.pattern,
                            type: parsed.type ?? 'general',
                            confidence,
                            score: typeof e.score === 'number' ? e.score : undefined,
                        };
                    }
                    catch {
                        return null;
                    }
                };
                // Tier 1 — semantic
                let results = [];
                let tier = 'semantic';
                // #3325: a thrown error and a genuine zero-match were indistinguishable
                // — `catch {}` discarded the former, `semantic?.results ?? []` treated
                // `{success: false, error}` (which searchEntries returns WITHOUT
                // throwing) as the latter. Capture whichever fires so a caller that
                // lands on tier=substring can tell why, instead of source-reading.
                let semanticError;
                try {
                    const semantic = await searchEntries({ query, namespace: 'pattern', limit: topK });
                    if (semantic && semantic.success === false) {
                        semanticError = semantic.error ?? 'searchEntries returned success:false';
                    }
                    results = (semantic?.results ?? [])
                        .map(parseEntry)
                        .filter((r) => r !== null);
                }
                catch (err) {
                    semanticError = sanitizeError(err);
                }
                // Tier 2 — substring scan (catches just-written entries before HNSW indexes them).
                // #2226: listEntries returns metadata only (no content/value — see open #2014),
                // so parseEntry would always null out here. Fetch each entry's content by key via
                // getEntry (which DOES return content) before parsing/matching. This is the path
                // that actually runs when the ReasoningBank controller is unavailable (the common
                // real-world state), so a stored pattern is now findable by search.
                if (results.length === 0) {
                    tier = 'substring';
                    const all = await listEntries({ namespace: 'pattern', limit: 200 });
                    const qLower = query.toLowerCase();
                    const matched = [];
                    for (const e of (all?.entries ?? [])) {
                        const meta = e;
                        let entry = meta;
                        // If the listing lacks content, hydrate it from the keyed store.
                        if (typeof meta.content !== 'string' && typeof meta.value !== 'string') {
                            const key = typeof meta.key === 'string' ? meta.key : (typeof meta.id === 'string' ? meta.id : null);
                            if (!key)
                                continue;
                            const got = await getEntry({ key, namespace: 'pattern' });
                            if (!got?.found || !got.entry)
                                continue;
                            entry = got.entry;
                        }
                        const parsed = parseEntry(entry);
                        if (!parsed)
                            continue;
                        const text = typeof parsed.pattern === 'string' ? parsed.pattern.toLowerCase() : '';
                        if (text.includes(qLower))
                            matched.push(parsed);
                        if (matched.length >= topK)
                            break;
                    }
                    results = matched;
                }
                // #1889 — controller label must match pattern-store's so the smoke
                // round-trip sees both ends agree. The store reports
                // `memory-store-fallback`; we use the same name + a `tier` field
                // to expose which sub-strategy fired.
                // #3288: degraded:true is the structural signal a caller can check
                // without already knowing to distrust an apparently-successful
                // response — matches agentbbs-tools.ts's degradedResult() convention.
                return {
                    results,
                    degraded: true,
                    reason: result ? `reasoningBank-empty:${result.controller ?? 'unknown'}` : 'reasoningBank-unavailable:registry-null',
                    controller: 'memory-store-fallback',
                    tier,
                    // #3325: when tier=substring because tier 1 hit a real error (thrown,
                    // or {success:false, error}) rather than a genuine zero-match,
                    // surface why — otherwise a hard failure and an honest "not found"
                    // are indistinguishable from the response alone.
                    ...(tier === 'substring' && semanticError ? { semanticError } : {}),
                    note: result
                        ? `ReasoningBank returned 0 results; tier=${tier} from pattern namespace.`
                        : `ReasoningBank controller unavailable; tier=${tier} from pattern namespace.`,
                };
            }
            catch (fallbackErr) {
                return { results: [], controller: 'unavailable', fallbackError: sanitizeError(fallbackErr) };
            }
        }
        catch (error) {
            return { results: [], error: sanitizeError(error) };
        }
    },
};

/**
 * Case-insensitive substring match over agentdb's reasoning_patterns table —
 * the rows ReasoningBank.storePattern() writes. Used only when the vector
 * search returns nothing. Returns [] when the table or handle is unavailable.
 */
function substringSearchReasoningPatterns(registry, query, k) {
    try {
        const db = registry?.getAgentDB?.()?.database;
        if (!db || typeof db.prepare !== 'function')
            return [];
        const like = `%${query.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        const rows = db.prepare("SELECT id, approach, success_rate FROM reasoning_patterns WHERE lower(approach) LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT ?").all(like, k);
        return rows.map((r) => ({ id: String(r.id), content: r.approach, score: r.success_rate ?? 0 }));
    }
    catch {
        return [];
    }
}
/**
 * Search patterns via ReasoningBank controller.
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
            if (typeof reasoningBank.searchPatterns === 'function') {
                results = await reasoningBank.searchPatterns({ task: options.query, k: options.topK || 5, threshold: options.minConfidence || 0.3 });
            }
            else {
                results = await reasoningBank.search(options.query, { topK: options.topK || 5, minScore: options.minConfidence || 0.3 });
            }
            // #3327 Finding A — agentdb returns ReasoningPattern[]: the text lives in
            // `approach` and the cosine score in `similarity`. Neither `content`/
            // `pattern` nor `score`/`confidence` exists on that shape, so the old
            // mapping produced `content: ''` and `score: 0` for every hit even when
            // the search itself succeeded. Read the real fields first, keeping the
            // legacy names as fallbacks for the pre-agentdb shape.
            let mapped = Array.isArray(results) ? results.map((r) => ({
                id: String(r.id ?? r.patternId ?? ''),
                content: r.approach ?? r.content ?? r.pattern ?? '',
                score: r.similarity ?? r.score ?? r.successRate ?? r.confidence ?? 0,
            })) : [];
            // #4643 — with agentdb's mock embedder (Transformers.js failed to load:
            // offline, or a failed `sharp` install) a passage and a query embed to
            // unrelated hash vectors, so the vector search misses a pattern that
            // storePattern just wrote. Scan the same reasoning_patterns table for the
            // query text, as the LocalReasoningBank branch below does over getAll().
            if (mapped.length === 0)
                mapped = substringSearchReasoningPatterns(registry, options.query, options.topK || 5);
            return { results: mapped, controller: 'reasoningBank' };
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
