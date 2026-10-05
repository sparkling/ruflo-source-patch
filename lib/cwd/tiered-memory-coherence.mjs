// Residual cross-process visibility in the durable fallback introduced for
// ruvnet/ruflo#2887 (closed by #2966). This is a cache-coherence repair, not a
// claim that the original lost-write bug remains open. Reuse the supplied
// native connection; never open a database or create another storage owner.
// Retire this contribution when upstream passes the two-reader, replacement,
// deletion, temporal-history and failed-refresh probes. Unknown bytes fail closed.
export const ISSUE = 'https://github.com/ruvnet/ruflo/issues/2887';
export const HYDRATE_OLD = `    hydrate() {
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
    }`;
export const HYDRATE_NEW = `    hydrate() {
        if (!this.db)
            return;
        // ruflo-source-patch (#2887): a long-lived reader must see other
        // native writers. Build a complete snapshot before replacing views;
        // a failed read throws, and repeating it cannot duplicate the archive.
        const rows = this.db
            .prepare('SELECT * FROM tiered_memory ORDER BY ts ASC')
            .all();
        const tiers = { working: new Map(), episodic: new Map(), semantic: new Map() };
        const archived = [];
        for (const row of rows) {
            const entry = rowToEntry(row);
            if (row.archived) {
                archived.push(entry);
                if (archived.length > MAX_ARCHIVED)
                    archived.shift();
                continue;
            }
            const map = tiers[entry.tier] ?? tiers.working;
            if (map.size >= MAX_PER_TIER)
                continue;
            map.set(entry.key, entry);
        }
        this.tiers = tiers;
        this.archived = archived;
    }`;
const STORE_OLD = `    store(key, value, tier = 'working', options) {
        const tierName = VALID_TIERS.includes(tier) ? tier : 'working';
        const t = this.tiers[tierName];
        const id = nextId();
        let superseded = null;
        if (options?.supersedes) {
            superseded = this.supersede(options.supersedes, id);
        }
        // Evict oldest if at capacity`;
const STORE_NEW = `    store(key, value, tier = 'working', options) {
        this.hydrate();
        const tierName = VALID_TIERS.includes(tier) ? tier : 'working';
        const id = nextId();
        let superseded = null;
        if (options?.supersedes) {
            superseded = this.supersede(options.supersedes, id);
        }
        const t = this.tiers[tierName];
        // Evict oldest if at capacity`;
export const COHERENCE_EDITS = [
  { find: HYDRATE_OLD, replace: HYDRATE_NEW },
  { find: STORE_OLD, replace: STORE_NEW },
  ...[
    '    supersede(idOrKey, newId) {',
    '    recall(query, topK = 5, options) {',
    '    remove(key) {',
    '    getTierStats() {',
  ].map(find => ({ find, replace: `${find}\n        this.hydrate();` })),
];
export const TIERED_MEMORY_ENTRIES = [
  ['@claude-flow', 'memory', 'dist', 'tiered-memory.js'],
  ['@claude-flow', 'cli', 'node_modules', '@claude-flow', 'memory', 'dist', 'tiered-memory.js'],
].map((suffix, index) => ({
  id: `memory/tiered-coherence-${index ? 'nested' : 'hoisted'}`,
  target: 'memory', suffix, edits: COHERENCE_EDITS,
}));

export function patchTieredMemorySource(source) {
  let next = source;
  for (const edit of COHERENCE_EDITS) {
    if (next.includes(edit.replace)) continue;
    if (next.split(edit.find).length !== 2)
      return { next: source, missing: ['missing or ambiguous tiered-memory anchor'] };
    next = next.replace(edit.find, edit.replace);
  }
  return { next, missing: [] };
}
