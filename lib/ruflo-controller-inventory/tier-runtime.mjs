// ruvnet/ruflo#4712: methods inside the existing native TieredMemoryStore.
// No map enumeration: hydration caps and duplicate keys cannot hide durable rows.
export const TIER_ANCHOR = '    /** Load persisted rows back into the tier maps and the archive. */';
export const TIER_RUNTIME = String.raw`    // ruflo-source-patch (controller-inventory tier store #4712)
    listEntries(options = {}) {
        const allowed = ['limit', 'offset', 'tier', 'state', 'asOf'];
        if (!options || typeof options !== 'object' || Array.isArray(options)
            || Object.keys(options).some(key => !allowed.includes(key)))
            throw new Error('invalid-tier-inventory-arguments');
        const { limit = 50, offset = 0, tier, state = 'all', asOf = Date.now() } = options;
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500
            || !Number.isSafeInteger(offset) || offset < 0
            || tier !== undefined && !VALID_TIERS.includes(tier)
            || !['all', 'active', 'expired', 'not-yet-valid', 'superseded'].includes(state)
            || !Number.isSafeInteger(asOf) || asOf < 0 || asOf > 8640000000000000)
            throw new Error('invalid-tier-inventory-arguments');
        if (!this.db) throw new Error('durable-tier-inventory-unavailable');
        // Count/filter metadata only. Payloads are fetched only for the requested
        // page. Keyset batches avoid hydration limits and hidden clipping.
        let cursor = null, total = 0;
        const selected = [];
        for (;;) {
            const clauses = [], params = [];
            if (tier !== undefined) { clauses.push('tier = ?'); params.push(tier); }
            if (cursor) { clauses.push('(ts < ? OR (ts = ? AND id < ?))'); params.push(cursor.ts, cursor.ts, cursor.id); }
            const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
            const rows = this.db.prepare('SELECT id, key, tier, ts, valid_from, valid_until, superseded_by, archived FROM tiered_memory'
                + where + ' ORDER BY ts DESC, id DESC LIMIT 500').all(...params);
            for (const row of rows) {
                if (typeof row.id !== 'string' || !row.id.length || !Number.isSafeInteger(row.ts))
                    throw new Error('invalid-native-tier-row');
                const entry = rowToEntry(row);
                const valid = isTemporallyValid(entry, asOf);
                const expired = Boolean(entry.validUntil) && Date.parse(entry.validUntil) <= asOf;
                const future = Boolean(entry.validFrom) && Date.parse(entry.validFrom) > asOf;
                const matches = state === 'all'
                    || state === 'active' && !row.archived && !entry.supersededBy && valid
                    || state === 'expired' && expired
                    || state === 'not-yet-valid' && future
                    || state === 'superseded' && Boolean(entry.supersededBy);
                if (!matches) continue;
                if (total >= offset && selected.length < limit) selected.push({ ...entry, archived: Boolean(row.archived) });
                total++;
            }
            if (rows.length < 500) break;
            cursor = rows[rows.length - 1];
        }
        const items = selected.map(metadata => {
            const entry = this.getEntry(metadata.id, { asOf });
            if (!entry || ['id', 'key', 'tier', 'ts', 'validFrom', 'validUntil', 'supersededBy', 'archived']
                .some(key => entry[key] !== metadata[key])) throw new Error('tier-inventory-changed-during-read; retry');
            return entry;
        });
        return { items, total, limit, offset, asOf, state, ...(tier !== undefined ? { tier } : {}),
            order: 'ts-desc-id-desc', consistency: 'live',
            limitation: 'Complete persisted metadata scan; page payloads are subsequent exact reads. Concurrent writes may change records, totals or pages. asOf fixes temporal evaluation only; this is not a snapshot. Active means nonarchived, nonsuperseded and temporally valid, not a bounded recall-map winner.' };
    }
    getEntry(id, options = {}) {
        if (typeof id !== 'string' || !id.length || id.length > 1000
            || !options || typeof options !== 'object' || Array.isArray(options)
            || Object.keys(options).some(key => key !== 'asOf'))
            throw new Error('invalid-tier-entry-arguments');
        const { asOf = Date.now() } = options;
        if (!Number.isSafeInteger(asOf) || asOf < 0 || asOf > 8640000000000000)
            throw new Error('invalid-tier-entry-arguments');
        if (!this.db) throw new Error('durable-tier-inventory-unavailable');
        const row = this.db.prepare('SELECT * FROM tiered_memory WHERE id = ?').get(id);
        if (!row) return null;
        const entry = rowToEntry(row);
        return { ...entry, archived: Boolean(row.archived),
            visibility: { asOf, temporallyValid: isTemporallyValid(entry, asOf),
                expired: Boolean(entry.validUntil) && Date.parse(entry.validUntil) <= asOf,
                notYetValid: Boolean(entry.validFrom) && Date.parse(entry.validFrom) > asOf,
                superseded: Boolean(entry.supersededBy),
                active: !row.archived && !entry.supersededBy && isTemporallyValid(entry, asOf) } };
    }
`;
