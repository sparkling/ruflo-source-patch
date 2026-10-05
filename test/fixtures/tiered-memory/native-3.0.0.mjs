/**
 * Tier-aware store with Zep/Graphiti-style temporal validity, durable when
 * given a SQLite handle.
 *
 * This is the store backing `agentdb_hierarchical-store` / `-recall` when
 * agentdb's native HierarchicalMemory is unavailable (previously an inline
 * stub in controller-registry.ts). It is promoted to a first-class module
 * so temporal knowledge semantics live in one tested place:
 *
 * - Facts may carry a validity window (`validFrom` / `validUntil`).
 * - Conflicting facts are INVALIDATED, not overwritten: `supersedes`
 *   stamps the old entry with `validUntil = now` + `supersededBy = <newId>`
 *   and archives it — the history stays queryable.
 * - `recall()` filters invalid entries by default; `includeExpired: true`
 *   is the audit escape hatch.
 * - Entries without temporal fields behave exactly as before (always valid).
 *
 * Durability (#2887): agentdb dropped its `HierarchicalMemory` export at
 * 3.0.0-alpha.17, so this store — not the native controller — is what every
 * `agentdb_hierarchical-store` call actually lands in. Purely in-memory, that
 * made every such write a silent no-op that still reported success. Pass a
 * better-sqlite3-compatible handle and the store writes through to a
 * `tiered_memory` table and rehydrates from it on construction; without a
 * handle it stays volatile and says so via {@link TieredMemoryStore.isDurable}.
 *
 * API shape is kept duck-type compatible with the previous stub so the CLI
 * memory-bridge keeps working unchanged:
 *   store(key, value, tier)   recall(query, topK)   getTierStats()
 *
 * IMPORTANT: this class must NOT expose both `getStats` and `promote` —
 * that pair is the bridge's detection signal for the REAL agentdb
 * HierarchicalMemory API.
 *
 * @module @claude-flow/memory/tiered-memory
 */
const TABLE_DDL = `
CREATE TABLE IF NOT EXISTS tiered_memory (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  tier TEXT NOT NULL,
  ts INTEGER NOT NULL,
  valid_from TEXT,
  valid_until TEXT,
  superseded_by TEXT,
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tiered_memory_key ON tiered_memory(key);
CREATE INDEX IF NOT EXISTS idx_tiered_memory_tier ON tiered_memory(tier, archived);
`;
function rowToEntry(row) {
    const entry = {
        id: row.id,
        key: row.key,
        value: row.value,
        tier: row.tier,
        ts: Number(row.ts),
    };
    if (row.valid_from)
        entry.validFrom = row.valid_from;
    if (row.valid_until)
        entry.validUntil = row.valid_until;
    if (row.superseded_by)
        entry.supersededBy = row.superseded_by;
    return entry;
}
const VALID_TIERS = ['working', 'episodic', 'semantic'];
const MAX_PER_TIER = 5000;
const MAX_ARCHIVED = 5000;
const MAX_VALUE_LENGTH = 100_000;
const MAX_QUERY_LENGTH = 10_000;
let idCounter = 0;
function nextId() {
    idCounter = (idCounter + 1) % Number.MAX_SAFE_INTEGER;
    return `tm_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}
/**
 * Returns true when the entry is valid at `nowMs`.
 * Entries without temporal fields are always valid (legacy behavior).
 * Unparseable timestamps are ignored (treated as absent) rather than
 * silently hiding the entry.
 */
export function isTemporallyValid(entry, nowMs = Date.now()) {
    if (entry.validFrom) {
        const from = Date.parse(entry.validFrom);
        if (!Number.isNaN(from) && from > nowMs)
            return false; // not yet valid
    }
    if (entry.validUntil) {
        const until = Date.parse(entry.validUntil);
        if (!Number.isNaN(until) && until <= nowMs)
            return false; // expired/superseded
    }
    return true;
}
/**
 * Tier-aware in-memory store with temporal validity and per-tier size
 * limits to prevent unbounded memory growth.
 */
export class TieredMemoryStore {
    tiers = {
        working: new Map(),
        episodic: new Map(),
        semantic: new Map(),
    };
    /**
     * Superseded entries are moved here so a same-key re-store cannot
     * clobber the historical fact. Bounded FIFO.
     */
    archived = [];
    db = null;
    /**
     * @param options.db better-sqlite3-compatible handle. When supplied the
     *   store writes through to `tiered_memory` and rehydrates from it, so
     *   entries survive the process. Without it the store is volatile and
     *   {@link isDurable} returns false — callers must treat a write as lost
     *   on exit rather than reporting success (#2887).
     */
    constructor(options) {
        const db = options?.db ?? null;
        if (!db)
            return;
        try {
            db.exec(TABLE_DDL);
            this.db = db;
            this.hydrate();
        }
        catch {
            // Schema creation failed — stay volatile and report it honestly via
            // isDurable() rather than pretending the handle works.
            this.db = null;
        }
    }
    /** True when writes are persisted to the backing table. */
    isDurable() {
        return this.db !== null;
    }
    /** Durability mode, for surfacing to MCP callers. */
    getPersistence() {
        return this.db ? 'sqlite' : 'volatile';
    }
    /**
     * Actual row count in the backing table (not the in-memory maps), so
     * health checks can detect a claimed-write / empty-table mismatch.
     * Returns null when volatile — there is no table to count.
     */
    countPersisted() {
        if (!this.db)
            return null;
        try {
            const row = this.db.prepare('SELECT COUNT(*) AS n FROM tiered_memory').get();
            return Number(row?.n ?? 0);
        }
        catch {
            return null;
        }
    }
    /** Load persisted rows back into the tier maps and the archive. */
    hydrate() {
        if (!this.db)
            return;
        const rows = this.db
            .prepare('SELECT * FROM tiered_memory ORDER BY ts ASC')
            .all();
        for (const row of rows) {
            const entry = rowToEntry(row);
            if (row.archived) {
                this.archived.push(entry);
                if (this.archived.length > MAX_ARCHIVED)
                    this.archived.shift();
                continue;
            }
            const map = this.tiers[entry.tier] ?? this.tiers.working;
            if (map.size >= MAX_PER_TIER)
                continue;
            map.set(entry.key, entry);
        }
    }
    /**
     * Write-through. Throws on failure so a store that cannot be persisted
     * fails loudly instead of reporting success for a lost write.
     */
    persist(entry, archived) {
        if (!this.db)
            return;
        this.db
            .prepare(`INSERT INTO tiered_memory (id, key, value, tier, ts, valid_from, valid_until, superseded_by, archived)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           key = excluded.key, value = excluded.value, tier = excluded.tier, ts = excluded.ts,
           valid_from = excluded.valid_from, valid_until = excluded.valid_until,
           superseded_by = excluded.superseded_by, archived = excluded.archived`)
            .run(entry.id, entry.key, entry.value, entry.tier, entry.ts, entry.validFrom ?? null, entry.validUntil ?? null, entry.supersededBy ?? null, archived ? 1 : 0);
    }
    /** Drop a persisted row (used by eviction and remove()). */
    unpersist(id) {
        if (!this.db)
            return;
        try {
            this.db.prepare('DELETE FROM tiered_memory WHERE id = ?').run(id);
        }
        catch {
            // A failed eviction leaves a stale row; harmless next to losing a write.
        }
    }
    /**
     * Store an entry. Same-key stores within a tier overwrite (legacy
     * behavior); use `options.supersedes` to invalidate-and-keep instead.
     */
    store(key, value, tier = 'working', options) {
        const tierName = VALID_TIERS.includes(tier) ? tier : 'working';
        const t = this.tiers[tierName];
        const id = nextId();
        let superseded = null;
        if (options?.supersedes) {
            superseded = this.supersede(options.supersedes, id);
        }
        // Evict oldest if at capacity
        if (t.size >= MAX_PER_TIER) {
            const oldestKey = t.keys().next().value;
            if (oldestKey !== undefined) {
                const evicted = t.get(oldestKey);
                t.delete(oldestKey);
                if (evicted)
                    this.unpersist(evicted.id);
            }
        }
        const entry = {
            id,
            key,
            value: value.substring(0, MAX_VALUE_LENGTH),
            tier: tierName,
            ts: Date.now(),
        };
        if (options?.validFrom)
            entry.validFrom = options.validFrom;
        if (options?.validUntil)
            entry.validUntil = options.validUntil;
        // Persist BEFORE publishing to the in-memory map: a throw here must not
        // leave a value visible in-process that never reached disk (#2887).
        const replaced = t.get(key);
        this.persist(entry, false);
        if (replaced && replaced.id !== entry.id)
            this.unpersist(replaced.id);
        t.set(key, entry);
        return {
            id, key, tier: tierName, superseded,
            durable: this.db !== null,
            persistence: this.getPersistence(),
        };
    }
    /**
     * Invalidate an existing entry (matched by id first, then by key) by
     * stamping `validUntil = now` + `supersededBy = newId` and moving it to
     * the archive. The entry is NOT deleted — `recall(..., { includeExpired:
     * true })` still returns it.
     */
    supersede(idOrKey, newId) {
        const found = this.findActive(idOrKey);
        if (!found)
            return null;
        const { map, entry } = found;
        const now = new Date().toISOString();
        entry.validUntil = now;
        entry.supersededBy = newId;
        map.delete(entry.key);
        this.persist(entry, true);
        this.archived.push(entry);
        if (this.archived.length > MAX_ARCHIVED) {
            const dropped = this.archived.shift();
            if (dropped)
                this.unpersist(dropped.id);
        }
        return { id: entry.id, key: entry.key, validUntil: now };
    }
    /**
     * Substring recall across tiers, newest first. By default only
     * temporally-valid entries are returned; pass `{ includeExpired: true }`
     * to audit superseded / expired / future-dated facts too.
     */
    recall(query, topK = 5, options) {
        const safeTopK = Math.min(Math.max(1, topK), 100);
        const q = query.toLowerCase().substring(0, MAX_QUERY_LENGTH);
        const includeExpired = options?.includeExpired === true;
        const now = Date.now();
        const results = [];
        const consider = (entry) => {
            if (!entry.key.toLowerCase().includes(q) && !entry.value.toLowerCase().includes(q)) {
                return false;
            }
            if (!includeExpired && !isTemporallyValid(entry, now))
                return false;
            results.push(entry);
            return true;
        };
        outer: for (const map of Object.values(this.tiers)) {
            for (const entry of map.values()) {
                consider(entry);
                if (results.length >= safeTopK * 3)
                    break outer; // early exit for large stores
            }
        }
        if (includeExpired && results.length < safeTopK * 3) {
            for (const entry of this.archived) {
                consider(entry);
                if (results.length >= safeTopK * 3)
                    break;
            }
        }
        return results.sort((a, b) => b.ts - a.ts).slice(0, safeTopK);
    }
    /** Hard-delete an active entry by key (used by hierarchical-delete). */
    remove(key) {
        for (const map of Object.values(this.tiers)) {
            const entry = map.get(key);
            if (!entry)
                continue;
            map.delete(key);
            this.unpersist(entry.id);
            return true;
        }
        return false;
    }
    /** Per-tier active counts plus the superseded-archive size. */
    getTierStats() {
        const stats = {};
        for (const [name, map] of Object.entries(this.tiers)) {
            stats[name] = map.size;
        }
        stats.superseded = this.archived.length;
        return stats;
    }
    findActive(idOrKey) {
        // Prefer id match (exact provenance), fall back to key match.
        for (const map of Object.values(this.tiers)) {
            for (const entry of map.values()) {
                if (entry.id === idOrKey)
                    return { map, entry };
            }
        }
        for (const map of Object.values(this.tiers)) {
            const entry = map.get(idOrKey);
            if (entry)
                return { map, entry };
        }
        return null;
    }
}
export default TieredMemoryStore;
//# sourceMappingURL=tiered-memory.js.map