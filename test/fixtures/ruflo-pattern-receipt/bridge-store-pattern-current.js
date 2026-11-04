// Exact published @claude-flow/cli 3.71.0 and 3.71.1 functions; source-only fixture.
// Source: dist/src/memory/memory-bridge.js; no real backend is imported or opened.
// bridgeStoreEntry SHA256 31d22f794a649abd4f9d2a4a5ed45f42fa5fe74e7f756376ba8e595752168304
export async function bridgeStoreEntry(options) {
    if (!operationContext.getStore()?.active)
        return withBridgeOperation(() => bridgeStoreEntry(options));
    // ADR-323 — validated once in storeEntry() before this is reached on that
    // path, but bridgeStoreEntry() also has direct internal callers, so check
    // again here rather than trust every call site.
    if (options.provenanceType !== undefined && !isValidProvenanceType(options.provenanceType)) {
        return {
            success: false,
            id: '',
            error: `Invalid provenance type "${options.provenanceType}"`,
        };
    }
    const registry = await getRegistry(options.dbPath);
    if (!registry)
        return null;
    const ctx = getDb(registry);
    if (!ctx)
        return null;
    if (options.appendOnly && !options.requireNative) {
        return { success: false, id: '', error: 'Immutable append requires a native writer' };
    }
    if (options.appendConditions && (!options.requireNative || !options.appendOnly)) {
        return { success: false, id: "", error: "Conditional append requires native append-only storage" };
    }
    if (options.requireNative && (ctx.agentdb?.isWasm === true || typeof ctx.db.inTransaction !== 'boolean'
        || typeof ctx.db.transaction !== 'function' || ctx.db.memory !== false || typeof ctx.db.name !== 'string'
        || !ctx.db.name || canonicalDbPath(ctx.db.name) !== canonicalDbPath(options.dbPath))) {
        return { success: false, id: '', error: 'Native memory writer required; refusing non-native bridge driver' };
    }
    try {
        const { key, value, namespace = 'default', tags = [], ttl } = options;
        let provenanceType = options.provenanceType ?? 'unknown';
        // An omitted type on an upsert means "update the value", not "erase the
        // existing trust label". New rows still receive the backward-compatible
        // unknown default.
        if (options.upsert && !options.appendOnly && options.provenanceType === undefined) {
            try {
                const existing = ctx.db.prepare('SELECT provenance_type FROM memory_entries WHERE namespace = ? AND key = ? LIMIT 1').get(namespace, key);
                provenanceType = existing?.provenance_type || 'unknown';
            }
            catch { /* legacy schema or new row — keep unknown */ }
        }
        const id = generateId('entry');
        const now = Date.now();
        // #2245 — record the activity so signalsProcessed stops being a dead
        // zero. Fire-and-forget; never blocks the write path.
        try {
            const intel = await import('./intelligence.js');
            intel.recordSignalProcessed();
        }
        catch { /* intelligence module not yet initialised */ }
        // Phase 5: MutationGuard validation before write
        const guardResult = await guardValidate(registry, 'store', { key, namespace, size: value.length });
        if (!guardResult.allowed) {
            return { success: false, id, error: `MutationGuard rejected: ${guardResult.reason}` };
        }
        // Generate embedding via AgentDB's embedder, falling back to the local
        // chain (#3325). If neither can produce one, the row is still written but
        // the result says why instead of silently storing embedding=NULL.
        let embeddingJson = null;
        let embeddingArr = null;
        let dimensions = 0;
        let model = 'local';
        let embeddingError;
        if (options.generateEmbeddingFlag !== false && value.length > 0) {
            const emb = await embedForBridge(ctx.agentdb, value);
            if (emb.vector) {
                embeddingArr = emb.vector;
                embeddingJson = JSON.stringify(embeddingArr);
                dimensions = embeddingArr.length;
                model = emb.model;
            }
            else {
                embeddingError = emb.reason;
            }
        }
        // #2775: strict-insert path now auto-resurrects soft-deleted tombstones
        // via ON CONFLICT DO UPDATE ... WHERE status='deleted'. Rationale:
        // `bridgeDeleteEntry` performs a soft delete (status='deleted'), so the
        // `UNIQUE(namespace, key)` slot stays occupied — before this fix, a
        // natural `delete → store` sequence hit UNIQUE, the catch below returned
        // `null`, `storeEntry` fell back to the sql.js whole-image path, and the
        // #2735 -wal/-shm sidecar guard refused with a message about a "native
        // WAL connection" that had nothing to do with the actual failure.
        //
        // Semantics under the new strict-insert SQL:
        //   • no existing row               → INSERT succeeds, changes = 1
        //   • existing row, status='deleted' → resurrected in-place, changes = 1
        //   • existing row, status='active'  → ON CONFLICT WHERE=false suppresses
        //                                       the update, changes = 0 (checked
        //                                       below → typed "already exists"
        //                                       error, NEVER a null demotion).
        // Upsert path (INSERT OR REPLACE) is unchanged.
        const immutableInsertSql = `INSERT INTO memory_entries (
          id, key, namespace, content, type,
          embedding, embedding_dimensions, embedding_model,
          tags, metadata, provenance_type, created_at, updated_at, expires_at, status
        ) VALUES (?, ?, ?, ?, 'semantic', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`;
        const insertSql = options.appendOnly ? immutableInsertSql : options.upsert
            ? `INSERT OR REPLACE INTO memory_entries (
          id, key, namespace, content, type,
          embedding, embedding_dimensions, embedding_model,
          tags, metadata, provenance_type, created_at, updated_at, expires_at, status
        ) VALUES (?, ?, ?, ?, 'semantic', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
            : `INSERT INTO memory_entries (
          id, key, namespace, content, type,
          embedding, embedding_dimensions, embedding_model,
          tags, metadata, provenance_type, created_at, updated_at, expires_at, status
        ) VALUES (?, ?, ?, ?, 'semantic', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
        ON CONFLICT(namespace, key) DO UPDATE SET
          id                    = excluded.id,
          content               = excluded.content,
          embedding             = excluded.embedding,
          embedding_dimensions  = excluded.embedding_dimensions,
          embedding_model       = excluded.embedding_model,
          tags                  = excluded.tags,
          metadata              = excluded.metadata,
          provenance_type       = excluded.provenance_type,
          created_at            = excluded.created_at,
          updated_at            = excluded.updated_at,
          expires_at            = excluded.expires_at,
          status                = 'active'
        WHERE memory_entries.status = 'deleted'`;
        // #1941: provision a `vector_indexes` row for this namespace before the
        // entry insert. AgentDB's HNSW/router keys lookups by namespace via this
        // table — if it has no row for e.g. `claude-memories`, `memory_search`
        // returns 0 results even when memory_entries holds hundreds of rows for
        // that namespace. INSERT OR IGNORE so existing index rows are preserved.
        try {
            ctx.db
                .prepare(`INSERT OR IGNORE INTO vector_indexes (id, name, dimensions) VALUES (?, ?, ?)`)
                .run(namespace, namespace, dimensions || 384);
        }
        catch { /* vector_indexes may not exist on legacy DBs — fall through */ }
        const stmt = ctx.db.prepare(insertSql);
        const insert = () => stmt.run(id, key, namespace, value, embeddingJson, dimensions || null, model, tags.length > 0 ? JSON.stringify(tags) : null, '{}', provenanceType, now, now, ttl ? now + (ttl * 1000) : null);
        let runResult;
        try {
            runResult = options.appendOnly
                ? ctx.db.transaction(() => {
                    // Legacy native tables may predate UNIQUE(namespace,key). Serialize the exact
                    // logical-slot check with INSERT, including tombstones, instead of trusting DDL.
                    if (ctx.db.prepare('SELECT key FROM memory_entries WHERE namespace = ? AND key = ?').all(namespace, key).length) {
                        throw new AppendConditionFailed('immutable append rejected: logical key already exists');
                    }
                    if (options.appendConditions)
                        assertAppendConditions(ctx.db, validateAppendConditions(options.appendConditions));
                    return insert();
                }).immediate()
                : insert();
        }
        catch (error) {
            if (error instanceof AppendConditionFailed || error instanceof TypeError) {
                return { success: false, id: '', error: error.message };
            }
            throw error;
        }
        // A completed native write proves the bridge is currently healthy. Do not
        // retain a diagnostic from an earlier transient failure and append it to a
        // later, unrelated sql.js fallback refusal.
        bridgeFailureReasons.delete(canonicalDbPath(options.dbPath));
        // #2775: strict insert against an ACTIVE existing row → changes === 0
        // (the ON CONFLICT WHERE clause above suppressed the update). Surface
        // this as a typed data-level error rather than a bridge failure —
        // returning non-null so the caller does NOT demote to sql.js and does
        // NOT trip the #2735 whole-image guard with a misleading message.
        if (!options.upsert && (runResult?.changes ?? 0) === 0) {
            return {
                success: false,
                id,
                error: `key "${key}" already exists in namespace "${namespace}" — pass upsert=true (--upsert on the CLI) to update it`,
            };
        }
        // A non-vector immutable INSERT cannot change the vector count, even with concurrent
        // writers. Unlike historical strict mode, it never resurrects a vector tombstone.
        // #2558: keep `vector_indexes.total_vectors` accurate so status/tooling
        // stop reporting "HNSW index: 0 vectors" while embedded entries exist.
        if (!(options.appendOnly && embeddingJson === null))
            try {
                ctx.db
                    .prepare(`UPDATE vector_indexes SET
             total_vectors = (SELECT COUNT(*) FROM memory_entries
                              WHERE namespace = ? AND embedding IS NOT NULL),
             updated_at = ?
           WHERE name = ?`)
                    .run(namespace, now, namespace);
            }
            catch { /* vector_indexes may not exist on legacy DBs — non-fatal */ }
        // #2558: better-sqlite3 opens the DB in WAL mode and, for the small write
        // volumes typical of CLI usage, may never reach the auto-checkpoint
        // threshold — leaving committed rows only in the -wal file. WAL-blind
        // readers (the sql.js fallback search path; the statusline's read-only
        // `sqlite3` vector count) then see a stale/empty main DB file and report
        // "0 vectors" / empty search. A PASSIVE checkpoint flushes committed pages
        // into the main file without blocking writers. Best-effort, never fatal.
        let persistWarning;
        try {
            if (typeof ctx.db.pragma === 'function') {
                ctx.db.pragma('wal_checkpoint(PASSIVE)');
            }
        }
        catch (checkpointErr) {
            // #2968: on the sql.js fallback driver (engaged when better-sqlite3's
            // native binding never got built — e.g. a skipped optionalDependency
            // postinstall), this PRAGMA isn't implemented and throws "Invalid
            // PRAGMA command". sql.js has no WAL journal to checkpoint at all, so
            // this specific failure is the strongest signal available here that
            // the insert above may exist only in this process's in-memory image
            // and never reach disk — not the ordinary "non-WAL, busy, or
            // unsupported" case the old blanket catch assumed. Surface it rather
            // than swallow it silently; other pragma failures stay non-fatal.
            const msg = checkpointErr instanceof Error ? checkpointErr.message : String(checkpointErr);
            if (/Invalid PRAGMA/i.test(msg)) {
                persistWarning = `sql.js fallback driver in use — this write may not be durably persisted to disk (${msg}). Install better-sqlite3's native binding to restore durable writes (see issue #2968: npm rebuild better-sqlite3, or reinstall with install scripts enabled).`;
            }
        }
        // Phase 2: Invalidate cache so the next read fetches the fresh row.
        //
        // #3051 — this used to be a write-through with a partial payload
        // (`{ id, key, namespace, content, embedding }` — missing `tags`,
        // access_count, timestamps, metadata, provenance_type). Any read that
        // hit the cache then returned `tags: cached.tags || []` = `[]` for the
        // very entry that had just been written with real tags, so
        // `memory_store({ tags })` → `memory_retrieve()` looked like it silently
        // dropped tags. Invalidating instead of partial-cache-set forces the
        // next `bridgeGetEntry` to load the authoritative row (which correctly
        // parses tags/metadata from the JSON columns) and repopulate the cache
        // from that full shape.
        const cacheKey = entryCacheKey(namespace, key);
        await cacheInvalidate(registry, cacheKey);
        // Phase 4: AttestationLog write audit
        await logAttestation(registry, 'store', id, { key, namespace, hasEmbedding: !!embeddingJson });
        return {
            success: true,
            id,
            embedding: embeddingJson ? { dimensions, model } : undefined,
            rawEmbedding: embeddingArr ?? undefined,
            guarded: true,
            cached: true,
            attested: true,
            ...(persistWarning ? { persistWarning } : {}),
            ...(embeddingError ? { embeddingError } : {}),
        };
    }
    catch (err) {
        // #2775: distinguish a data-level UNIQUE constraint violation (key
        // already exists — expected outcome of a strict insert) from a real
        // bridge failure (registry gone, DB locked, disk full, etc.). The
        // ON CONFLICT clause on the strict-insert SQL above should normally
        // convert UNIQUE hits into a `changes === 0` result, so reaching here
        // with a UNIQUE error means the schema pre-dates the (namespace, key)
        // unique index or the conflict target didn't match — treat it as a
        // clean "already exists" so the caller never demotes to sql.js and
        // never triggers the #2735 whole-image guard with a misleading
        // "active native WAL connection" error.
        const msg = err instanceof Error ? err.message : String(err);
        if (/UNIQUE constraint failed/i.test(msg)) {
            return {
                success: false,
                id: '',
                error: `key "${options.key}" already exists in namespace "${options.namespace ?? 'default'}" — pass upsert=true (--upsert on the CLI) to update it`,
            };
        }
        // Returning null below demotes the caller to the sql.js whole-image path,
        // whose WAL-sidecar guard then reports a cause that has nothing to do with
        // what actually went wrong here. Record the real error so it can be
        // surfaced alongside that guard's message.
        bridgeFailureReasons.set(canonicalDbPath(options.dbPath), msg);
        return null;
    }
}

// bridgeStorePattern SHA256 5361790e9caa85e1f7986677a58754bc16eee956d623803b881793d517e48809
export async function bridgeStorePattern(options) {
    if (!operationContext.getStore()?.active)
        return withBridgeOperation(() => bridgeStorePattern(options));
    const registry = await getRegistry(options.dbPath);
    if (!registry)
        return null;
    try {
        const reasoningBank = registry.get('reasoningBank');
        const patternId = generateId('pattern');
        // #3327 Finding A — the real method is `storePattern`, and it takes a
        // ReasoningPattern, NOT the {id, content, type, confidence} shape used
        // here before. `reasoningBank.store` has never existed on agentdb's
        // ReasoningBank, so `typeof ... === 'function'` was always false and this
        // branch was dead code — every write fell through to bridge-fallback while
        // `agentdb_controllers` cheerfully reported `reasoningBank: enabled=true`.
        //
        // Contract (agentdb ReasoningBank.d.ts):
        //   storePattern({ taskType, approach, successRate, uses?, avgReward?,
        //                  tags?, metadata? }) => Promise<number>   // sqlite rowid
        // The embedded text is `${taskType}: ${approach}`, so the caller's pattern
        // text must land in `approach` for search to match on it.
        if (reasoningBank && typeof reasoningBank.storePattern === 'function') {
            const rowId = await reasoningBank.storePattern({
                taskType: options.type,
                approach: options.pattern,
                successRate: options.confidence,
                tags: [options.type, 'reasoning-pattern'],
                metadata: options.metadata,
            });
            // storePattern returns a numeric rowid; surface it as the caller-facing
            // id so a later getPattern/deletePattern by this id resolves.
            return {
                success: true,
                patternId: rowId != null ? String(rowId) : patternId,
                controller: 'reasoningBank',
            };
        }
        // The intelligence module's LocalReasoningBank (registered when agentdb's
        // own ReasoningBank is unavailable) has store()/findSimilar() but no
        // storePattern(). bridgeSearchPatterns reads it through findSimilar(), so
        // the write must land there too, with an embedding from the same
        // generateEmbedding() the search uses. Otherwise store and search split
        // across two backends and a stored pattern is never found.
        if (reasoningBank && typeof reasoningBank.store === 'function' && typeof reasoningBank.findSimilar === 'function') {
            let embedding = [];
            try {
                const { generateEmbedding } = await import('./memory-initializer.js');
                const emb = await generateEmbedding(options.pattern);
                if (emb && Array.isArray(emb.embedding))
                    embedding = emb.embedding;
            }
            catch { /* no embedder — findSimilar misses it, the getAll() substring scan still finds it */ }
            // store() returns false when it merges into an existing pattern with the
            // same content; that is still a successful write.
            reasoningBank.store({
                id: patternId,
                type: options.type,
                content: options.pattern,
                confidence: options.confidence,
                embedding,
                metadata: options.metadata,
            });
            // Saves are debounced; a short-lived CLI process can exit first.
            if (typeof reasoningBank.flushToDisk === 'function')
                reasoningBank.flushToDisk();
            return {
                success: true,
                patternId,
                controller: 'reasoningBank',
                hasEmbedding: embedding.length > 0,
            };
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
        // #3691: bridgeStoreEntry reports data-level failures (MutationGuard
        // rejection, nothing written) as a truthy {success:false}. Do not turn
        // that into a success receipt — refuse at this boundary.
        if (!result.success) {
            return {
                success: false,
                patternId: '',
                controller: 'bridge-fallback',
                error: result.error ?? 'pattern write was not persisted',
            };
        }
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
        // #3324: bridgeStoreEntry's `result.id` is its OWN internally generated
        // row id (generateId('entry')), a different value from the `key` the row
        // was actually stored under. getEntry/memory_retrieve look up by `key`,
        // so returning result.id here handed the caller a handle that can never
        // be read back — return `patternId` (the real key) instead.
        // #3325: say whether the row got a vector. Without one, Tier-1 (semantic)
        // pattern search cannot find it — report that here, at write time.
        return {
            success: true,
            patternId,
            controller: 'bridge-fallback',
            hasEmbedding: !!result.embedding,
            ...(result.embeddingError ? { embeddingError: result.embeddingError } : {}),
        };
    }
    catch (err) {
        // #3327 Finding A — this catch is what hid the defect for months. When
        // ReasoningBank threw `embedPassage is not a function`, the error was
        // discarded and the caller saw an ordinary fallback, indistinguishable
        // from "no controller registered". Record it so `agentdb_health` and the
        // degraded `reason` can name the real cause instead of guessing.
        bridgeFailureReasons.set(canonicalDbPath(options.dbPath), err instanceof Error ? err.message : String(err));
        return null;
    }
}
