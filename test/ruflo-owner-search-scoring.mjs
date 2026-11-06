import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { patchSource, reverse, isPatched } from '../lib/ruflo-memory-owner/patcher.mjs';

// Exact published native calculations, with inert registry/SQLite/embedding
// seams. Never load native intelligence or open a managed memory store.
const source = fs.readFileSync(new URL('./fixtures/ruflo-memory-owner/search-scoring-3.71.4.js', import.meta.url), 'utf8');
const patched = patchSource(source);
assert.deepEqual(patched.missing, []);
assert(isPatched(patched.next));
assert.equal(reverse(patched.next), source);
assert.equal(patchSource(patched.next).next, patched.next);
assert(patchSource(source + source).missing.length);

async function exercise(text, rows, options = {}) {
  const queries = []; let done = false, servedBeforeComplete = false, yields = 0;
  const database = { prepare(sql) {
    return { all(...args) { queries.push({ sql, args }); if (options.readFailure) throw Error('native read failed'); return rows; } };
  } };
  const context = vm.createContext({ Map, Math, JSON, Date, Promise,
    setTimeout: (fn, ms) => { yields++; return setTimeout(fn, ms); },
    operationContext: { getStore: () => ({ active: true }) },
    getRegistry: async () => ({}), getDb: () => ({ db: database, agentdb: {} }),
    isValidProvenanceType: value => value !== 'invalid', liveMemoryRowSql: () => 'native_liveness_predicate',
    embedForBridge: async () => ({ vector: options.noVector ? null : [0.25, 0.5, 0.75] }),
    resolveBridgeSearchWindow: () => 10000, DEFAULT_SEARCH_THRESHOLD: 0.3,
  });
  const search = vm.runInContext(text.replace('export ', '') + '\nbridgeSearchEntries', context);
  const sentinel = new Promise(resolve => setImmediate(() => { servedBeforeComplete = !done; resolve(); }));
  const result = await search({ query: 'retained context semantic advantage experiment adaptation', namespace: 'research', limit: 6, ...options.input });
  done = true; await sentinel;
  const normalized = result === null ? null : JSON.parse(JSON.stringify(result));
  if (normalized) delete normalized.searchTime;
  return { result: normalized, queries: JSON.parse(JSON.stringify(queries)), servedBeforeComplete, yields };
}
const rows = Array.from({ length: 400 }, (_, i) => ({ id: 'id-' + i, key: 'key-' + i, namespace: 'research',
  content: ('Retained context semantic advantage experiment adaptation ' + i + ' ').repeat(200),
  embedding: i % 3 ? '[0.25,0.5,0.75]' : 'invalid-native-vector', provenance_type: 'tool_result' }));
const before = await exercise(source, rows), after = await exercise(patched.next, rows);
assert.equal(before.servedBeforeComplete, false, 'reproduce synchronous native corpus/scoring starvation');
assert.equal(after.servedBeforeComplete, true, 'pending owner I/O runs during the same native calculation');
assert(after.yields > 0);
assert.deepEqual(after.result, before.result, 'exact native scores, vector/keyword fusion, provenance, truncation and ranking');
assert.deepEqual(after.queries, before.queries, 'same single native snapshot, window, predicates and bound arguments');
for (const [data, options] of [[[], {}], [rows.slice(0, 8), { noVector: true }],
  [rows.slice(0, 8), { input: { threshold: 0.99, provenanceFilter: ['tool_result'] } }],
  [rows.slice(0, 8), { input: { provenanceFilter: ['invalid'] } }], [rows, { readFailure: true }]]) {
  const a = await exercise(source, data, options), b = await exercise(patched.next, data, options);
  assert.deepEqual(b.result, a.result); assert.deepEqual(b.queries, a.queries);
}
console.log('PASS native search scheduling: original I/O starvation reproduced; exact SQL, corpus calculations and results preserved');
