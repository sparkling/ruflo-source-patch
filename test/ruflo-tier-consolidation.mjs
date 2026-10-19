import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { patchTieredMemorySource } from '../lib/cwd/tiered-memory-coherence.mjs';

const args = process.argv.slice(2);
if (args[0] && path.isAbsolute(args[0]) && !args[0].endsWith('package.json'))
  assert.ok(fs.statSync(args.shift()).isDirectory());
assert.ok(args.length === 0 || (args.length === 2 && args[0] === '--native-cli' && path.isAbsolute(args[1])));
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-tier-consolidation-')));
process.env.RUFLO_SOURCE_PATCH_HOME = scratch;
process.env.RUFLO_NPX_ROOT = path.join(scratch, 'npx');
process.env.RUFLO_GLOBAL_ROOT = path.join(scratch, 'global');
const patcher = await import('../lib/ruflo-tier-consolidation/patcher.mjs');
const pristine = fs.readFileSync(new URL('./fixtures/tiered-memory/native-3.0.0.mjs', import.meta.url), 'utf8');
const source = patchTieredMemorySource(pristine);
assert.deepEqual(source.missing, []);
const patched = patcher.patchSource(source.next);
assert.deepEqual(patched.missing, []);
const file = path.join(scratch, 'patched.mjs');
fs.writeFileSync(file, patched.next);
const Current = (await import(pathToFileURL(file))).TieredMemoryStore;
const failure = ' { "task": "evaluated failed fixture", "success": false, "reward": -0.5, "critique": "preserve the failure" } ';
const success = JSON.stringify({ task: 'evaluated successful fixture', success: true, reward: 0.75 });

// Inert row adapter for portable tests. It implements only the native SQL
// operations this fixture exercises and never opens any managed database.
function fixtureDb() {
  const rows = new Map();
  const db = {
    rows, writes: 0, inserts: 0, failInsert: 0, immediateCalls: 0, queries: [],
    exec() {},
    transaction(fn) {
      const execute = () => {
        const before = new Map([...rows].map(([id, row]) => [id, { ...row }]));
        try { return fn(); }
        catch (error) { rows.clear(); for (const [id, row] of before) rows.set(id, row); throw error; }
      };
      execute.immediate = () => { this.immediateCalls++; return execute(); };
      return execute;
    },
    prepare(sql) {
      this.queries.push(sql);
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('SELECT * FROM tiered_memory ORDER BY')) return {
        all: () => [...rows.values()].map(row => ({ ...row })).sort((a, b) => a.ts - b.ts),
      };
      if (normalized.startsWith('INSERT INTO tiered_memory')) return { run: (...values) => {
        this.inserts++;
        if (this.failInsert === this.inserts) throw new Error('injected partial insert failure');
        if (!normalized.includes('ON CONFLICT') && rows.has(values[0])) throw new Error('duplicate fixture id');
        const names = ['id', 'key', 'value', 'tier', 'ts', 'valid_from', 'valid_until', 'superseded_by', 'archived'];
        rows.set(values[0], Object.fromEntries(names.map((name, index) => [name, values[index]])));
        this.writes++;
        return { changes: 1 };
      } };
      if (normalized === 'DELETE FROM tiered_memory WHERE id = ?') return { run: id => {
        this.writes++; return { changes: Number(rows.delete(id)) };
      } };
      if (normalized.startsWith('SELECT COUNT(*) AS n FROM tiered_memory')) return { get: (...params) => {
        let found = [...rows.values()];
        if (normalized.includes("tier = 'semantic'")) found = found.filter(row => row.tier === 'semantic');
        else if (normalized.includes('tier = ?')) found = found.filter(row => row.tier === params[0]);
        if (normalized.includes('archived = 0')) found = found.filter(row => !row.archived);
        return { n: found.length };
      } };
      if (normalized === "SELECT * FROM tiered_memory WHERE id = ? OR (key = ? AND tier = 'semantic') LIMIT 2")
        return { all: (id, key) => [...rows.values()]
          .filter(row => row.id === id || (row.key === key && row.tier === 'semantic'))
          .slice(0, 2).map(row => ({ ...row })) };
      if (normalized.startsWith('SELECT ') && normalized.includes(' FROM tiered_memory WHERE ')) {
        const query = (...params) => {
          let found = [...rows.values()]; let index = 0;
          const conditions = normalized.split(' WHERE ')[1].split(/ ORDER BY | LIMIT /)[0];
          for (const condition of conditions.split(' AND ')) {
            const match = condition.match(/^(id|key|tier|archived) = (\?|'[^']*'|\d+)$/);
            if (!match) throw new Error('unexpected fixture condition: ' + condition);
            const expected = match[2] === '?' ? params[index++] : match[2].startsWith("'") ? match[2].slice(1, -1) : Number(match[2]);
            found = found.filter(row => row[match[1]] === expected);
          }
          if (normalized.includes('LIMIT 2')) found = found.slice(0, 2);
          return found.map(row => ({ ...row }));
        };
        return { all: query, get: (...params) => query(...params)[0] };
      }
      throw new Error('unexpected fixture operation: ' + normalized);
    },
  };
  return db;
}
let sequence = 0;
const seed = (db, key, value = success, extra = {}) => {
  const row = { id: 'fixture-' + ++sequence, key, value, tier: 'episodic', ts: Date.now() - 100,
    valid_from: null, valid_until: null, superseded_by: null, archived: 0, ...extra };
  db.rows.set(row.id, row); return row;
};
const snapshot = db => JSON.stringify([...db.rows.values()]);
const applySources = plan => plan.entries.map(entry => ({ key: entry.sourceKey, expectedSha256: entry.sourceSha256 }));
const setup = (keys = ['episode']) => {
  const db = fixtureDb();
  for (const key of keys) seed(db, key);
  const store = new Current({ db });
  store.store = () => { throw new Error('consolidation must not call the truncating/evicting store path'); };
  store.unpersist = () => { throw new Error('consolidation must not delete retained rows'); };
  return { db, store };
};

try {
  const { REGISTRY_METHOD } = await import('../lib/ruflo-tier-consolidation/runtime.mjs');
  const factory = new Function('return ({' + REGISTRY_METHOD + '})')();
  let forwarded;
  const controller = factory.createConsolidationController.call({ get: name => {
    assert.equal(name, 'hierarchicalMemory');
    return { consolidate: options => { forwarded = options; return { source: 'tiered-memory', promoted: 1, pruned: 0 }; } };
  } });
  const requested = { sources: [{ key: 'episode' }], dryRun: true };
  const bridgeSource = patcher.SPECS.find(spec => spec.file === 'memory-bridge.js').edits[0][1];
  const bridge = new Function('operationContext', 'withBridgeOperation', 'getRegistry',
    bridgeSource.replace('export async function', 'async function') + '\nreturn bridgeConsolidate;')(
    { getStore: () => ({ active: true }) }, () => { throw Error('unexpected owner recursion'); },
    async () => ({ dbPath: 'existing-owner.db', get: () => controller }));
  const bridged = await bridge(requested);
  assert.equal(forwarded, requested, 'public bridge forwards the exact selected scope to the existing owner');
  assert.equal(bridged.success, true);
  assert.equal(bridged.dbPath, 'existing-owner.db');
  controller.consolidate = () => ({ source: 'stub', promoted: 0, pruned: 0 });
  assert.equal((await bridge(requested)).success, false, 'stub receipts cannot masquerade as consolidation');
  controller.consolidate = () => { throw Error('native owner failed'); };
  assert.match((await bridge(requested)).error, /native owner failed/);
  fs.writeFileSync(path.join(scratch, 'original.mjs'), pristine);
  const Original = (await import(pathToFileURL(path.join(scratch, 'original.mjs')))).TieredMemoryStore;
  assert.equal(Original.prototype.consolidate, undefined, 'extend the existing native owner; do not invent a separate controller');
  assert.equal(patcher.hasPatch(patched.next), true);
  assert.equal(patcher.isPatched(patched.next), true);
  assert.equal(patcher.reverse(patched.next), source.next);
  assert.deepEqual(patcher.patchSource(patched.next), { next: patched.next, applied: [], missing: [] });
  assert.ok(patcher.patchSource('unrecognised native source').missing.length > 0);

  const { db, store } = setup();
  for (const bad of [undefined, null, 'episode', {}, { sources: [] }, { sources: [{ key: '' }] },
    { sources: [{ key: 'episode' }, { key: 'episode' }] },
    { sources: Array.from({ length: 33 }, (_, index) => ({ key: 'key-' + index })) }])
    assert.throws(() => store.consolidate(bad));
  assert.throws(() => new Current().consolidate({ sources: [{ key: 'episode' }] }), undefined, 'volatile memory is not durable consolidation');
  const before = snapshot(db);
  const plan = store.consolidate({ sources: [{ key: 'episode' }] });
  assert.equal(typeof plan?.then, 'undefined', 'the transaction callback and API remain synchronous');
  assert.equal(plan.wouldPromote, 1);
  assert.equal(plan.entries.length, 1);
  assert.equal(snapshot(db), before, 'default dry-run never mutates rows');
  assert.equal(db.writes, 0);
  assert.equal(plan.entries[0].sourceKey, 'episode');
  assert.match(plan.entries[0].sourceSha256, /^[a-f0-9]{64}$/);
  assert.throws(() => store.consolidate({ sources: [{ key: 'episode' }], dryRun: false }));
  assert.throws(() => store.consolidate({ sources: [{ key: 'episode', expectedSha256: '0'.repeat(64) }], dryRun: false }));
  assert.equal(snapshot(db), before, 'missing or stale approval hash leaves all rows unchanged');

  const changed = setup();
  const changedPlan = changed.store.consolidate({ sources: [{ key: 'episode' }] });
  changed.db.rows.get(changedPlan.entries[0].sourceId).value = failure;
  const changedBefore = snapshot(changed.db);
  assert.throws(() => changed.store.consolidate({ sources: applySources(changedPlan), dryRun: false }));
  assert.equal(snapshot(changed.db), changedBefore, 'a real source change invalidates the approved dry-run');

  const original = db.rows.get(plan.entries[0].sourceId);
  const sourceBytes = JSON.stringify(original);
  const applied = store.consolidate({ sources: applySources(plan), dryRun: false });
  assert.equal(applied.promoted, 1);
  assert.equal(applied.pruned, 0);
  assert.equal(JSON.stringify(db.rows.get(original.id)), sourceBytes, 'source row and raw JSON bytes are preserved');
  const copied = db.rows.get(plan.entries[0].targetId);
  assert.equal(copied.tier, 'semantic');
  assert.equal(copied.value, original.value);
  assert.equal(copied.valid_from, original.valid_from);
  assert.equal(copied.valid_until, original.valid_until);
  const after = snapshot(db);
  assert.equal(store.consolidate({ sources: applySources(plan), dryRun: false }).promoted, 0);
  assert.equal(snapshot(db), after, 'rerun does not duplicate or rewrite rows');
  assert.ok(db.immediateCalls > 0);
  const sourceQueries = db.queries.filter(query => query.includes("tier = 'episodic'"));
  assert.ok(sourceQueries.length > 0 && sourceQueries.every(query => query.endsWith('LIMIT 2')),
    'every explicit source lookup is bounded');

  const olderReader = new Current({ db });
  assert.deepEqual(olderReader.recall('failed-source'), []);
  const failedRow = seed(db, 'failed-source', failure, {
    valid_from: '2000-01-01T00:00:00.000Z', valid_until: '2999-01-01T00:00:00.000Z',
  });
  const failedPlan = store.consolidate({ sources: [{ key: failedRow.key }] });
  store.consolidate({ sources: applySources(failedPlan), dryRun: false });
  const failedCopy = db.rows.get(failedPlan.entries[0].targetId);
  assert.equal(failedCopy.value, failure);
  assert.equal(JSON.parse(failedCopy.value).success, false, 'an evaluated failure remains a failure');
  assert.equal(failedCopy.valid_from, failedRow.valid_from);
  assert.equal(failedCopy.valid_until, failedRow.valid_until);
  assert.ok(olderReader.recall('failed-source', 100).some(entry => entry.tier === 'semantic'), 'existing cache refresh sees the semantic copy');

  const invalidValues = ['ordinary fact', '{}', '[]', '{"task":"x","reward":1}',
    '{"task":"x","reward":1,"success":"yes"}',
    '{"task":"x","reward":0,"success":false,"success":true}',
    '{"task":"x","reward":0,"success":false,"succe\\u0073s":true}',
    JSON.stringify({ task: 'x', reward: 1, success: true, output: 4 }),
    JSON.stringify({ task: 'x'.repeat(65536), reward: 1, success: true })];
  for (const value of invalidValues) {
    const f = setup([]); seed(f.db, 'invalid', value);
    const saved = snapshot(f.db);
    assert.throws(() => f.store.consolidate({ sources: [{ key: 'invalid' }] }));
    assert.equal(snapshot(f.db), saved);
  }
  for (const extra of [{ archived: 1 }, { superseded_by: 'other' },
    { valid_until: '2000-01-01T00:00:00.000Z' }, { valid_from: '2999-01-01T00:00:00.000Z' }]) {
    const f = setup([]); seed(f.db, 'invalid', success, extra);
    assert.throws(() => f.store.consolidate({ sources: [{ key: 'invalid' }] }));
  }
  const ambiguous = setup(); seed(ambiguous.db, 'episode');
  assert.throws(() => ambiguous.store.consolidate({ sources: [{ key: 'episode' }] }));

  const capacity = setup();
  const capacityPlan = capacity.store.consolidate({ sources: [{ key: 'episode' }] });
  for (let index = 0; index < 5000; index++) seed(capacity.db, 'semantic-' + index, success, { tier: 'semantic' });
  const capacityBefore = snapshot(capacity.db);
  assert.throws(() => capacity.store.consolidate({ sources: applySources(capacityPlan), dryRun: false }));
  assert.equal(snapshot(capacity.db), capacityBefore, 'capacity refusal never evicts');

  const collision = setup();
  const collisionPlan = collision.store.consolidate({ sources: [{ key: 'episode' }] });
  seed(collision.db, collisionPlan.entries[0].targetKey, failure, { tier: 'semantic' });
  const collisionBefore = snapshot(collision.db);
  assert.throws(() => collision.store.consolidate({ sources: applySources(collisionPlan), dryRun: false }));
  assert.equal(snapshot(collision.db), collisionBefore, 'target collision never overwrites');
  const retainedCollision = setup();
  const retainedPlan = retainedCollision.store.consolidate({ sources: [{ key: 'episode' }] });
  seed(retainedCollision.db, retainedPlan.entries[0].targetKey, failure, { tier: 'semantic', archived: 1 });
  const retainedBefore = snapshot(retainedCollision.db);
  assert.throws(() => retainedCollision.store.consolidate({ sources: applySources(retainedPlan), dryRun: false }));
  assert.equal(snapshot(retainedCollision.db), retainedBefore, 'archived destination history is protected too');

  const rollback = setup(['first', 'second']);
  const rollbackPlan = rollback.store.consolidate({ sources: [{ key: 'first' }, { key: 'second' }] });
  const rollbackBefore = snapshot(rollback.db);
  rollback.db.failInsert = rollback.db.inserts + 2;
  assert.throws(() => rollback.store.consolidate({ sources: applySources(rollbackPlan), dryRun: false }), /injected partial insert failure/);
  assert.equal(snapshot(rollback.db), rollbackBefore, 'second insert failure rolls back the first insert');

  if (args[1]) {
    const cliPackage = fs.realpathSync(args[1]);
    assert.equal(JSON.parse(fs.readFileSync(cliPackage, 'utf8')).name, '@claude-flow/cli');
    const memoryEntry = createRequire(cliPackage).resolve('@claude-flow/memory');
    const agentEntry = createRequire(memoryEntry).resolve('agentdb');
    const databaseModule = createRequire(agentEntry).resolve('better-sqlite3');
    const Database = createRequire(agentEntry)('better-sqlite3');
    const nativeSource = fs.readFileSync(path.join(path.dirname(memoryEntry), 'tiered-memory.js'), 'utf8');
    const coherent = patchTieredMemorySource(nativeSource);
    assert.deepEqual(coherent.missing, []);
    const nativePatch = patcher.patchSource(coherent.next);
    assert.deepEqual(nativePatch.missing, []);
    const nativeFile = path.join(scratch, 'native-patched.mjs');
    fs.writeFileSync(nativeFile, nativePatch.next);
    const NativeStore = (await import(pathToFileURL(nativeFile))).TieredMemoryStore;
    const sharedFile = path.join(scratch, 'private-native-fixture.db');
    const handle = new Database(sharedFile);
    try {
      const parent = new NativeStore({ db: handle });
      assert.deepEqual(parent.recall('native-failed-source'), []);
      const code = `import { createRequire } from 'node:module';
import { TieredMemoryStore } from ${JSON.stringify(pathToFileURL(nativeFile).href)};
const Database = createRequire(import.meta.url)(${JSON.stringify(databaseModule)});
const db = new Database(${JSON.stringify(sharedFile)});
try {
  const store = new TieredMemoryStore({ db });
  if (process.argv[1] !== 'rerun') store.store('native-failed-source', ${JSON.stringify(failure)}, 'episodic');
  const plan = store.consolidate({ sources: [{ key: 'native-failed-source' }] });
  const sources = plan.entries.map(entry => ({ key: entry.sourceKey, expectedSha256: entry.sourceSha256 }));
  const applied = store.consolidate({ sources, dryRun: false });
  console.log(JSON.stringify({ plan, applied, rerun: store.consolidate({ sources, dryRun: false }) }));
} finally { db.close(); }`;
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 10000 });
      assert.equal(child.status, 0, child.stderr);
      const result = JSON.parse(child.stdout);
      assert.equal(result.applied.promoted, 1);
      assert.equal(result.applied.pruned, 0);
      assert.equal(result.rerun.promoted, 0);
      const reopened = spawnSync(process.execPath, ['--input-type=module', '-e', code, 'rerun'], { encoding: 'utf8', timeout: 10000 });
      assert.equal(reopened.status, 0, reopened.stderr);
      assert.equal(JSON.parse(reopened.stdout).applied.promoted, 0, 'another fresh process recognises the existing copy');
      const recalled = parent.recall('native-failed-source', 100);
      assert.equal(recalled.length, 2);
      assert.ok(recalled.some(row => row.tier === 'semantic'));
      assert.ok(recalled.every(row => row.value === failure));
      assert.ok(recalled.every(row => JSON.parse(row.value).success === false));
      assert.equal(parent.countPersisted(), 2);
      parent.store('rollback-first', success, 'episodic');
      parent.store('rollback-second', success, 'episodic');
      // A private fixture trigger supplies an actual SQLite second-insert failure.
      handle.exec("CREATE TRIGGER fail_second_consolidation BEFORE INSERT ON tiered_memory WHEN NEW.key = 'consolidated:rollback-second' BEGIN SELECT RAISE(ABORT, 'fixture second insert failure'); END");
      const rollbackPlan = parent.consolidate({ sources: [{ key: 'rollback-first' }, { key: 'rollback-second' }] });
      assert.throws(() => parent.consolidate({ sources: applySources(rollbackPlan), dryRun: false }), /fixture second insert failure/);
      assert.equal(parent.countPersisted(), 4);
      assert.equal(parent.recall('consolidated:rollback-first', 100)
        .some(entry => entry.key === 'consolidated:rollback-first' && entry.tier === 'semantic'), false,
      'real SQLite rolled back the first copy');
    } finally { handle.close(); }
    console.log('PASS native private SQLite: independent-process consolidation, exact failure/source preservation, restart idempotence and existing-reader recall');
  }
  console.log('PASS tier consolidation: explicit bounded plan, approved hashes, safe episodes, preserved sources, no eviction/overwrite, rollback and idempotence');
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
