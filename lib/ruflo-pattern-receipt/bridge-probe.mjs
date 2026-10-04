import assert from 'node:assert/strict';

export async function exerciseBridgePatternReceipt(source) {
  const start = source.indexOf('export async function bridgeStorePattern(options) {');
  const end = source.indexOf('\n}\n', start);
  if (start < 0 || end < start) throw new Error('native bridge pattern function absent');
  let body = source.slice(start, end + 3).replace('export async function ', 'async function ');
  body = body.replaceAll("await import('./memory-initializer.js')", 'await fixtureImport()');
  const create = new Function('getRegistry', 'bridgeStoreEntry', 'bridgeGetEntry', 'fixtureImport',
    `const operationContext = { getStore: () => ({ active: true }) };
const generateId = () => 'pattern-exact-fixture'; const bridgeFailureReasons = new Map();
const canonicalDbPath = path => path;
${body}
return bridgeStorePattern;`);
  const outcomes = [];
  const legacyController = body.includes("typeof reasoningBank.store === 'function'");
  async function run(mode, reasoning = false) {
    let stored, writes = 0, reads = 0, hnsw = 0, nativeCalls = 0;
    const input = { pattern: 'A synthetic native bridge pattern', type: 'verification', confidence: 0.7,
      metadata: { synthetic: true }, dbPath: '/fixture/canonical.db' };
    const native = reasoning ? legacyController ? { store: async args => {
      nativeCalls++; assert.equal(args.content, input.pattern);
      assert.equal(args.id, 'pattern-exact-fixture'); assert.equal(args.type, input.type);
      assert.equal(args.confidence, input.confidence); assert.deepEqual(args.metadata, input.metadata);
    } } : { storePattern: async args => {
      nativeCalls++; assert.equal(args.approach, input.pattern); return 17;
    } } : null;
    const fn = create(async path => { assert.equal(path, input.dbPath); return { get: () => native }; },
      async args => {
        writes++; stored = args;
        if (mode === 'null') return null;
        if (mode === 'false') return { success: false, error: 'fixture typed native write refusal' };
        return { success: true, id: 'different-row-id', rawEmbedding: [1, 2], embedding: { dimensions: 2 },
          ...(mode === 'warning' ? { persistWarning: 'fixture durability unavailable' } : {}) };
      }, async args => {
        reads++;
        assert.deepEqual(args, { key: stored.key, namespace: 'pattern', dbPath: input.dbPath });
        if (mode === 'read-throw') throw new Error('fixture native reader refused');
        if (mode === 'read-null') return null;
        if (mode === 'absent') return { success: true, found: false };
        if (mode === 'read-false') return { success: false, error: 'fixture typed reader refusal' };
        return { success: true, found: true, entry: {
          key: mode === 'wrong-key' ? 'other' : stored.key,
          namespace: mode === 'wrong-namespace' ? 'other' : stored.namespace,
          content: mode === 'wrong-content' ? 'different' : stored.value,
        } };
      }, async () => ({ addToHNSWIndex: async () => { hnsw++; if (mode === 'index-error') throw new Error('fixture optional index failure'); } }));
    const result = await fn(input);
    return { result, writes, reads, hnsw, nativeCalls, stored };
  }
  for (const mode of ['false', 'warning', 'read-throw', 'read-null', 'absent', 'read-false', 'wrong-key', 'wrong-namespace', 'wrong-content']) {
    const row = await run(mode); outcomes.push({ mode, success: row.result?.success });
    assert.equal(row.result?.success, false, `${mode}: native bridge must not mask failed persistence`);
    assert.equal(row.hnsw, 0, 'unverified write cannot be added to the search index');
    if (['false', 'warning'].includes(mode)) assert.equal(row.reads, 0, 'refused/durability-warning write cannot be rescued by cache');
  }
  for (const mode of ['exact', 'index-error']) {
    const row = await run(mode);
    assert.equal(row.result.success, true); assert.equal(row.result.verified, true);
    assert.equal(row.result.patternId, row.stored.key); assert.equal(row.result.namespace, 'pattern');
    assert.equal(row.reads, 1); assert.equal(row.writes, 1); assert.equal(row.hnsw, 1);
  }
  const missing = await run('null'); assert.equal(missing.result, null); assert.equal(missing.reads, 0);
  const native = await run('exact', true);
  assert.deepEqual(native.result, { success: true, patternId: legacyController ? 'pattern-exact-fixture' : '17', controller: 'reasoningBank' });
  assert.equal(native.writes, 0); assert.equal(native.reads, 0); assert.equal(native.nativeCalls, 1);
  return outcomes;
}
