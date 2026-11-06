function bm25Score(queryTerms, docWords, docLength, avgDocLength, docCount, termDocFreqs) {
    const k1 = 1.2;
    const b = 0.75;
    let score = 0;
    for (const term of queryTerms) {
        const tf = docWords.filter(w => w === term || w.includes(term)).length;
        if (tf === 0)
            continue;
        const df = termDocFreqs.get(term) || 1;
        const idf = Math.log((docCount - df + 0.5) / (df + 0.5) + 1);
        const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLength / Math.max(1, avgDocLength))));
        score += idf * tfNorm;
    }
    return score;
}

function tokenizeCorpus(rows) {
    return rows.map(row => {
        const contentLower = (row.content || '').toLowerCase();
        return { contentLower, words: contentLower.split(/\s+/) };
    });
}

function computeTermDocFreqs(queryTerms, docs) {
    const termDocFreqs = new Map();
    let totalLength = 0;
    for (const doc of docs) {
        totalLength += doc.words.length;
        for (const term of queryTerms) {
            if (doc.contentLower.includes(term)) {
                termDocFreqs.set(term, (termDocFreqs.get(term) || 0) + 1);
            }
        }
    }
    return { termDocFreqs, avgDocLength: docs.length > 0 ? totalLength / docs.length : 1 };
}

function cosineSim(a, b) {
    if (!a || !b || a.length === 0 || b.length === 0)
        return 0;
    const len = Math.min(a.length, b.length);
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < len; i++) {
        const ai = a[i], bi = b[i];
        dot += ai * bi;
        normA += ai * ai;
        normB += bi * bi;
    }
    const mag = Math.sqrt(normA * normB);
    return mag === 0 ? 0 : dot / mag;
}

export async function bridgeSearchEntries(options) {
    if (!operationContext.getStore()?.active)
        return withBridgeOperation(() => bridgeSearchEntries(options));
    if (options.provenanceFilter?.length) {
        const invalid = options.provenanceFilter.filter(p => !isValidProvenanceType(p));
        if (invalid.length > 0)
            return null; // caller (searchEntries) demotes to sql.js, which returns a typed error
    }
    const registry = await getRegistry(options.dbPath);
    if (!registry)
        return null;
    const ctx = getDb(registry);
    if (!ctx)
        return null;
    try {
        const { query: queryStr, namespace, limit = 10, threshold = DEFAULT_SEARCH_THRESHOLD, provenanceFilter } = options;
        const effectiveNamespace = namespace || 'all';
        const startTime = Date.now();
        // Generate query embedding — same agentdb-then-local chain as the write
        // path (#3325), so rows embedded by the local fallback are searchable.
        // No vector → keyword (BM25) search only.
        const queryEmbedding = (await embedForBridge(ctx.agentdb, queryStr)).vector;
        // better-sqlite3: .prepare().all() returns array of objects
        // ADR-323: compose namespace + provenance filters into one WHERE clause.
        const filters = [];
        const filterParams = [];
        if (effectiveNamespace !== 'all') {
            filters.push('namespace = ?');
            filterParams.push(effectiveNamespace);
        }
        if (provenanceFilter?.length) {
            filters.push(`provenance_type IN (${provenanceFilter.map(() => '?').join(',')})`);
            filterParams.push(...provenanceFilter);
        }
        const whereExtra = filters.length > 0 ? `AND ${filters.join(' AND ')}` : '';
        let rows;
        try {
            // #2982/#2976: this pre-rank SELECT truncates the corpus to 1000 rows
            // before BM25/embedding scoring runs. Without ORDER BY, SQLite returns
            // rows in arbitrary storage order (effectively oldest-inserted-first at
            // scale), so on any corpus over 1000 entries the newest — and often
            // most relevant — rows never reach scoring at all. bridgeListEntries()
            // already orders by updated_at DESC for the same reason; mirror it here.
            const stmt = ctx.db.prepare(`
        SELECT id, key, namespace, content, embedding, provenance_type
        FROM memory_entries
        WHERE ${liveMemoryRowSql()} ${whereExtra}
        ORDER BY updated_at DESC
        LIMIT ${resolveBridgeSearchWindow()}
      `);
            rows = filterParams.length > 0 ? stmt.all(...filterParams) : stmt.all();
        }
        catch {
            return null;
        }
        // Phase 2: Compute BM25 term stats for the corpus. Tokenize the corpus a
        // single time and reuse the per-doc `{contentLower, words}` for term-freq,
        // BM25 scoring, and the coverage floor below.
        const queryTerms = queryStr.toLowerCase().split(/\s+/).filter(t => t.length > 1);
        const docs = tokenizeCorpus(rows);
        const { termDocFreqs, avgDocLength } = computeTermDocFreqs(queryTerms, docs);
        const docCount = rows.length;
        const results = [];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const doc = docs[i];
            let semanticScore = 0;
            let bm25ScoreVal = 0;
            // Semantic scoring via cosine similarity
            if (queryEmbedding && row.embedding) {
                try {
                    const embedding = JSON.parse(row.embedding);
                    semanticScore = cosineSim(queryEmbedding, embedding);
                }
                catch {
                    // Invalid embedding
                }
            }
            // Phase 2: BM25 keyword scoring (replaces String.includes fallback)
            if (queryTerms.length > 0 && row.content) {
                bm25ScoreVal = bm25Score(queryTerms, doc.words, doc.words.length, avgDocLength, docCount, termDocFreqs);
                // Normalize BM25 to 0-1 range (cap at 10 for normalization)
                bm25ScoreVal = Math.min(bm25ScoreVal / 10, 1.0);
            }
            // #2558: keyword-coverage floor for the lexical signal.
            // BM25's IDF collapses toward zero when a term appears in most/all
            // documents (routine on small memory corpora), and the /10 normalization
            // crushed exact-keyword hits well below the default 0.3 threshold — so
            // `memory search` recalled NOTHING even when the content literally
            // contained the query term (issue #2558: "keyword recall random"). The
            // pre-BM25 fallback guaranteed keyword recall via matchCount/words*0.5;
            // this restores that guarantee. `coverage` is the fraction of query
            // terms present in the document — a full-coverage hit must always be
            // recallable regardless of IDF.
            const contentLower = doc.contentLower;
            const matchedTerms = queryTerms.filter(t => contentLower.includes(t)).length;
            const coverage = queryTerms.length > 0 ? matchedTerms / queryTerms.length : 0;
            const lexicalScore = Math.max(bm25ScoreVal, coverage);
            // Recall-friendly fusion: a strong semantic OR lexical signal alone must
            // clear the threshold. `blended` (0.6 semantic + 0.4 lexical) drives
            // ranking; taking max() with the raw semantic score means (a) a genuinely
            // similar entry is never dropped just because it lacks the query's exact
            // words, and (b) a full-coverage keyword hit (lexical=1 → blended≥0.4) is
            // never dropped just because its embedding cosine is low or negative.
            const blended = 0.6 * Math.max(0, semanticScore) + 0.4 * lexicalScore;
            const score = Math.max(blended, semanticScore);
            if (score >= threshold) {
                // Phase 4: ExplainableRecall provenance
                const provenance = queryEmbedding
                    ? `semantic:${semanticScore.toFixed(3)}+lexical:${lexicalScore.toFixed(3)}`
                    : `lexical:${lexicalScore.toFixed(3)}`;
                results.push({
                    id: String(row.id).substring(0, 12),
                    key: row.key || String(row.id).substring(0, 15),
                    content: (row.content || '').substring(0, 60) + ((row.content || '').length > 60 ? '...' : ''),
                    score,
                    namespace: row.namespace || 'default',
                    provenance,
                    provenanceType: row.provenance_type || 'unknown',
                });
            }
        }
        results.sort((a, b) => b.score - a.score);
        return {
            success: true,
            results: results.slice(0, limit),
            searchTime: Date.now() - startTime,
            searchMethod: queryEmbedding ? 'hybrid-bm25-semantic' : 'bm25-only',
        };
    }
    catch {
        return null;
    }
}
