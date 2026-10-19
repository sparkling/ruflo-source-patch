import { CONTEXT_NEW } from '../ruflo-context-contract/patcher.mjs';

// Reuse the reviewed episode contract; never infer outcomes from ordinary facts.
const start = CONTEXT_NEW.indexOf('    const isObject =');
const end = CONTEXT_NEW.indexOf('    try {\n        const query =');
if (start < 0 || end <= start) throw Error('Reviewed episode validator boundary changed');
const validation = CONTEXT_NEW.slice(start, end);

export function consolidateTieredMemory(options = {}) {
    // rsp-reviewed-episode-contract
    if (!isObject(options) || Object.keys(options).some(key => !['sources', 'dryRun'].includes(key))
        || !Array.isArray(options.sources) || !options.sources.length || options.sources.length > 32
        || (options.dryRun !== undefined && typeof options.dryRun !== 'boolean'))
        throw new Error('consolidation requires 1..32 explicit sources and optional boolean dryRun');
    const dryRun = options.dryRun !== false;
    const keys = new Set();
    for (const source of options.sources) {
        if (!isObject(source) || Object.keys(source).some(key => !['key', 'expectedSha256'].includes(key))
            || typeof source.key !== 'string' || !source.key.trim() || source.key.length > 512
            || /[\u0000-\u001f\u007f]/.test(source.key) || keys.has(source.key)
            || (source.expectedSha256 !== undefined && !/^[a-f0-9]{64}$/.test(source.expectedSha256))
            || (!dryRun && typeof source.expectedSha256 !== 'string'))
            throw new Error('each source needs a unique key and apply requires its expectedSha256 from dry-run');
        keys.add(source.key);
    }
    const db = this.db;
    if (!db || typeof db.transaction !== 'function') throw new Error('native transactional tier owner required');
    const columns = ['id', 'key', 'value', 'tier', 'ts', 'valid_from', 'valid_until', 'superseded_by', 'archived'];
    const same = (a, b) => columns.every(key => a[key] === b[key]);
    const hash = row => rspTierHash('sha256').update(JSON.stringify(columns.map(key => row[key]))).digest('hex');
    const execute = db.transaction(() => {
        const entries = [];
        const selected = [];
        const now = Date.now();
        for (const requested of options.sources) {
            const rows = db.prepare("SELECT * FROM tiered_memory WHERE key = ? AND tier = 'episodic' AND archived = 0 LIMIT 2").all(requested.key);
            if (rows.length !== 1) throw new Error('source missing or ambiguous: ' + requested.key);
            const source = rows[0];
            if (typeof source.value !== 'string' || !episode({ value: source.value })
                || source.superseded_by || !isTemporallyValid(rowToEntry(source), now)
                || ['valid_from', 'valid_until'].some(key => source[key] && !Number.isFinite(Date.parse(source[key]))))
                throw new Error('source is not a valid explicit evaluated episode: ' + requested.key);
            const digest = hash(source);
            if (requested.expectedSha256 !== undefined && requested.expectedSha256 !== digest)
                throw new Error('source changed since dry-run: ' + requested.key);
            const target = { ...source, id: 'tm_consolidated_' + digest,
                key: 'consolidated:' + source.key, tier: 'semantic' };
            const existing = db.prepare("SELECT * FROM tiered_memory WHERE id = ? OR (key = ? AND tier = 'semantic') LIMIT 2").all(target.id, target.key);
            if (existing.length > 1 || (existing.length === 1 && !same(existing[0], target)))
                throw new Error('semantic destination conflicts with retained history: ' + requested.key);
            entries.push({ sourceKey: source.key, sourceId: source.id, sourceSha256: digest,
                targetKey: target.key, targetId: target.id, alreadyConsolidated: existing.length === 1 });
            selected.push({ source, target });
        }
        const wouldPromote = entries.filter(entry => !entry.alreadyConsolidated).length;
        const count = Number(db.prepare("SELECT COUNT(*) AS n FROM tiered_memory WHERE tier = 'semantic' AND archived = 0").get()?.n);
        if (!Number.isSafeInteger(count) || count < 0 || count + wouldPromote > MAX_PER_TIER)
            throw new Error('semantic tier capacity exceeded; consolidation never evicts retained entries');
        if (!dryRun) {
            const insert = db.prepare('INSERT INTO tiered_memory (id, key, value, tier, ts, valid_from, valid_until, superseded_by, archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
            for (let index = 0; index < entries.length; index++) {
                if (entries[index].alreadyConsolidated) continue;
                const target = selected[index].target;
                insert.run(...columns.map(key => target[key]));
            }
            for (const { source, target } of selected) {
                const original = db.prepare('SELECT * FROM tiered_memory WHERE id = ?').get(source.id);
                const retained = db.prepare('SELECT * FROM tiered_memory WHERE id = ?').get(target.id);
                if (!original || !retained || !same(source, original) || !same(target, retained))
                    throw new Error('consolidation exact readback failed; transaction rolled back');
            }
        }
        return { source: 'tiered-memory', operation: 'preserve-evaluated-episodes-in-semantic-tier',
            dryRun, targetTier: 'semantic', sourceIntegrityVerified: !dryRun, qualityInference: false,
            promoted: dryRun ? 0 : wouldPromote, wouldPromote,
            alreadyConsolidated: entries.length - wouldPromote, pruned: 0, entries };
    });
    if (!dryRun && typeof execute.immediate !== 'function') throw new Error('native immediate transaction required');
    return dryRun ? execute() : execute.immediate();
}

export const TIER_METHOD = consolidateTieredMemory.toString()
    .replace('function consolidateTieredMemory', 'consolidate')
    .replace('    // rsp-reviewed-episode-contract', validation.trimEnd());
export const REGISTRY_METHOD = `    /** Scoped consolidation reuses the existing hierarchical owner (#2977). */
    createConsolidationController() {
        return { consolidate: options => {
            const store = this.get('hierarchicalMemory');
            if (!store || typeof store.consolidate !== 'function')
                throw new Error('Scoped tier consolidation owner unavailable');
            return store.consolidate(options);
        } };
    }`;
export const TOOL_SCHEMA = `        type: 'object',
        additionalProperties: false,
        properties: {
            sources: { type: 'array', minItems: 1, maxItems: 32, items: {
                type: 'object', additionalProperties: false, required: ['key'],
                properties: { key: { type: 'string', minLength: 1, maxLength: 512 },
                    expectedSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' } },
            } },
            dryRun: { type: 'boolean', default: true },
        },
        required: ['sources'],`;
