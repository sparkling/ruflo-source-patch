import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { findVendorRootWith } from './fixtures.mjs';
import { patchSource, reverse, isPatched } from '../lib/ruflo-memory-owner/patcher.mjs';
import { priorSearchEdits, searchSelectionEdit } from '../lib/ruflo-memory-owner/search.mjs';

// Exact published native calculations, with inert registry/SQLite/embedding
// seams. Never load native intelligence or open a managed memory store.
const source = fs.readFileSync(new URL('./fixtures/ruflo-memory-owner/search-scoring-3.71.4.js', import.meta.url), 'utf8');
const patched = patchSource(source);
assert.deepEqual(patched.missing, []);
assert(isPatched(patched.next));
assert.equal(reverse(patched.next), source);
assert.equal(patchSource(patched.next).next, patched.next);
assert(patchSource(source + source).missing.length);
const release154 = priorSearchEdits.reduce((text, pair) => text.replace(...pair), source);
assert.equal(reverse(release154), source);
assert.equal(patchSource(release154).next, patched.next, '154 scheduling upgrades without losing prior yields');

async function exercise(text, rows, options = {}) {
  const queries = []; let done = false, servedBeforeComplete = false, yields = 0;
  const database = { prepare(sql) {
    if (sql.startsWith('PRAGMA')) return { all: () => [] }; // unproved schema keeps native SQL
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

// Exercise the exact native SELECT with disposable SQLite only. Native modules
// and managed stores are never opened; the schema guard is the shared #4686 one.
const vendor = findVendorRootWith('dist/src/memory/memory-bridge.js', ['export async function bridgeSearchEntries(options) {']);
const DB = createRequire(path.join(vendor, '@claude-flow/cli/package.json'))('better-sqlite3');
const statement = (text, db, filter, window) => {
  let livenessCalls = 0, windowCalls = 0;
  const stmt = new Function('ctx', 'liveMemoryRowSql', 'whereExtra', 'resolveBridgeSearchWindow',
    text + '\nreturn stmt;')({ db }, () => { livenessCalls++; return "(status = 'active' OR status IS NULL)"; },
    filter, () => { windowCalls++; return window; });
  assert.equal(livenessCalls, 1, 'same native expiry evaluation instant');
  assert.equal(windowCalls, 1, 'same native configuration read');
  return stmt;
};
for (const mode of ['rowid', 'without-rowid', 'shadow-null', 'shadow-nonunique', 'shadow-case', 'shadow-generated', 'view']) {
  const db = new DB(':memory:');
  db.exec(`CREATE TABLE memory_entries (id TEXT PRIMARY KEY, key TEXT, namespace TEXT, content TEXT,
    embedding TEXT, provenance_type TEXT, updated_at INTEGER, status TEXT)${mode === 'without-rowid' ? ' WITHOUT ROWID' : ''}`);
  if (mode.startsWith('shadow-')) db.exec(`ALTER TABLE memory_entries ADD COLUMN ${mode === 'shadow-case' ? '_ROWID_' : '_rowid_'} TEXT${
    mode === 'shadow-nonunique' ? " DEFAULT 'shared'" : mode === 'shadow-generated' ? " GENERATED ALWAYS AS ('shared') VIRTUAL" : ''}`);
  // Explicit columns allow rowid-shadow fixtures to retain their extra column.
  const write = db.prepare('INSERT INTO memory_entries(id,key,namespace,content,embedding,provenance_type,updated_at,status) VALUES(?,?,?,?,?,?,?,?)');
  db.transaction(() => { for (let i = 0; i < 160; i++) write.run('id-' + i, 'key-' + i, i % 2 ? 'research' : 'other',
    'Original 😀 漢字 ' + i, i % 3 ? '[0.25,0.5]' : null, i % 5 ? 'tool_result' : 'user_claim',
    Math.floor(i / 4), i % 17 ? 'active' : 'deleted'); })();
  if (mode === 'view') db.exec('ALTER TABLE memory_entries RENAME TO original_entries; CREATE VIEW memory_entries AS SELECT * FROM original_entries');
  for (const [filter, args] of [['', []], ['AND namespace = ?', ['research']],
    ['AND namespace = ? AND provenance_type IN (?)', ['research', 'tool_result']]]) for (const window of [0, 1, 39, 10000]) {
    const queries = [], observed = { prepare(sql) { queries.push(sql); return db.prepare(sql); } };
    const before = statement(searchSelectionEdit[0], db, filter, window).all(...args);
    const after = statement(searchSelectionEdit[1], observed, filter, window).all(...args);
    assert.deepEqual(after, before, 'exact native selected rows, order, cap, filters and payloads: ' + mode);
    const dataSql = queries.find(sql => !sql.startsWith('PRAGMA'));
    assert.equal(dataSql.includes('WHERE _rowid_ IN'), mode === 'rowid', 'unproved schemas preserve native SQL');
  }
  db.close();
}
if (process.env.RSP_SEARCH_BENCHMARK === '1') {
  const db = new DB(':memory:');
  db.exec('CREATE TABLE memory_entries(id TEXT, key TEXT, namespace TEXT, content TEXT, embedding TEXT, provenance_type TEXT, updated_at INTEGER, status TEXT)');
  const write = db.prepare('INSERT INTO memory_entries VALUES(?,?,?,?,?,?,?,?)');
  const content = 'synthetic retained context 😀 '.repeat(200), embedding = JSON.stringify(Array(384).fill(0.123456));
  db.transaction(() => { for (let i = 0; i < 8000; i++) write.run('id-' + i, 'key-' + i, 'research', content,
    embedding, 'tool_result', (i * 3571) % 8000, 'active'); })();
  let expected;
  for (const [name, text] of [['native-payload-sort', searchSelectionEdit[0]], ['native-window-first', searchSelectionEdit[1]]]) {
    const queries = [], observed = { prepare(sql) { queries.push(sql); return db.prepare(sql); } };
    const started = performance.now(), rows = statement(text, observed, 'AND namespace = ?', 1000).all('research');
    const elapsedMs = performance.now() - started;
    if (expected) assert.deepEqual(rows, expected); else expected = rows;
    const sql = queries.find(query => !query.startsWith('PRAGMA'));
    console.log(JSON.stringify({ benchmark: name, elapsedMs, selected: rows.length,
      plan: db.prepare('EXPLAIN QUERY PLAN ' + sql).all('research').map(row => row.detail) }));
  }
  db.close();
}
console.log('PASS native search scheduling: original I/O starvation reproduced; exact SQL, corpus calculations and results preserved');
