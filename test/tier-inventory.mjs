import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-tier-inventory-')));
process.env.RUFLO_SOURCE_PATCH_HOME = scratch;
process.env.RUFLO_GLOBAL_ROOT = path.join(scratch, 'global/node_modules');
process.env.RUFLO_NPX_ROOT = path.join(scratch, 'npx');
const patch = await import('../lib/ruflo-controller-inventory/patcher.mjs');
const { patchTieredMemorySource } = await import('../lib/cwd/tiered-memory-coherence.mjs');
const { BRIDGE_RUNTIME: oldBridge, TOOL_RUNTIME: oldTools } = await import('../lib/ruflo-controller-inventory/historical.mjs');
const pristine = fs.readFileSync(new URL('./fixtures/tiered-memory/native-3.0.0.mjs', import.meta.url), 'utf8');
const now = Date.parse('2026-11-04T12:00:00Z');
const logs = [];
function fixtureDb() {
  const rows = new Map();
  return {
    fail: false, writes: 0, rows, exec() {},
    prepare(sql) {
      logs.push(sql);
      const read = () => { if (this.fail) throw Error('fixture native read denied'); return [...rows.values()].map(row => ({ ...row })); };
      if (sql.startsWith('SELECT COUNT')) return { get: () => ({ n: read().length }) };
      if (sql === 'SELECT * FROM tiered_memory WHERE id = ?') return { get: id => read().find(row => row.id === id) };
      if (sql.startsWith('SELECT *')) return { all: () => read().sort((a, b) => a.ts - b.ts) };
      if (sql.startsWith('SELECT id, key, tier')) return { all: (...params) => {
        let items = read();
        if (sql.includes('tier = ?')) { const tier = params.shift(); items = items.filter(row => row.tier === tier); }
        if (sql.includes('ts < ?')) { const [ts, , id] = params; items = items.filter(row => row.ts < ts || row.ts === ts && row.id < id); }
        return items.sort((a, b) => b.ts - a.ts || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)).slice(0, 500)
          .map(({ value, ...row }) => row);
      } };
      if (sql.startsWith('INSERT')) return { run: (...values) => {
        this.writes++;
        rows.set(values[0], Object.fromEntries(['id', 'key', 'value', 'tier', 'ts', 'valid_from', 'valid_until', 'superseded_by', 'archived'].map((key, i) => [key, values[i]])));
      } };
      if (sql.startsWith('DELETE')) return { run: id => { this.writes++; rows.delete(id); } };
      throw Error('Unexpected fixture SQL: ' + sql);
    },
  };
}
async function load(source, name) {
  const applied = patch.patchSource(source);
  assert.deepEqual(applied.missing, []);
  const file = path.join(scratch, name + '.mjs'); fs.writeFileSync(file, applied.next);
  return (await import(pathToFileURL(file))).TieredMemoryStore;
}
function exercise(Store, db) {
  const owner = new Store({ db });
  const first = owner.store('same', 'original historical value', 'semantic');
  const second = owner.store('same', 'replacement current value', 'semantic', { supersedes: first.id });
  const expired = owner.store('expired', 'EXPIRED', 'working', { validUntil: '2020-01-01' });
  const future = owner.store('future', 'FUTURE', 'episodic', { validFrom: '2999-01-01' });
  const invalid = owner.store('invalid', 'INVALID DATE RETAINED', 'semantic', { validUntil: 'not-a-date' });
  const all = owner.listEntries({ limit: 2, asOf: now });
  assert.equal(all.total, 5); assert.equal(all.items.length, 2); assert.equal(all.state, 'all'); assert.equal(all.consistency, 'live');
  const ids = [0, 2, 4].flatMap(offset => owner.listEntries({ limit: 2, offset, asOf: now }).items.map(row => row.id));
  assert.equal(new Set(ids).size, 5); assert(ids.includes(first.id));
  const old = owner.getEntry(first.id, { asOf: now });
  assert.equal(old.value, 'original historical value'); assert.equal(old.archived, true); assert.equal(old.supersededBy, second.id);
  assert.equal(old.visibility.superseded, true); assert.equal(old.visibility.active, false);
  assert.equal(owner.getEntry(second.id, { asOf: now }).value, 'replacement current value');
  assert.equal(owner.getEntry('confirmed-absent'), null);
  assert.deepEqual(owner.listEntries({ offset: 5, asOf: now }).items, []);
  assert.equal(owner.listEntries({ tier: 'semantic', asOf: now }).total, 3);
  assert.equal(owner.listEntries({ state: 'superseded', asOf: now }).items[0].id, first.id);
  assert(owner.listEntries({ state: 'expired', asOf: now }).items.some(row => row.id === expired.id));
  assert.equal(owner.listEntries({ state: 'not-yet-valid', asOf: now }).items[0].id, future.id);
  assert.equal(owner.getEntry(invalid.id, { asOf: now }).visibility.temporallyValid, true);
  assert(owner.listEntries({ state: 'active', asOf: now }).items.some(row => row.id === invalid.id));
  const reopened = new Store({ db });
  assert.deepEqual(reopened.listEntries({ asOf: now }), owner.listEntries({ asOf: now }));
  assert.deepEqual(reopened.getEntry(first.id, { asOf: now }), old);
  for (const options of [null, [], { limit: 0 }, { limit: 501 }, { offset: -1 }, { offset: 0.5 },
    { tier: 'constructor' }, { state: 'unknown' }, { asOf: NaN }, { asOf: -1 }, { asOf: 8640000000000001 }, { key: 'ambiguous' }])
    assert.throws(() => owner.listEntries(options), /invalid-tier/);
  for (const id of ['', null, 1, 'x'.repeat(1001)]) assert.throws(() => owner.getEntry(id), /invalid-tier/);
  assert.throws(() => owner.getEntry(first.id, { state: 'all' }), /invalid-tier/);
  assert.throws(() => new Store().listEntries(), /unavailable/);
  assert.throws(() => new Store().getEntry(first.id), /unavailable/);
  return owner;
}
try {
  const applied = patch.patchSource(pristine);
  assert(patch.isPatched(applied.next)); assert.equal(patch.reverse(applied.next), pristine);
  assert.equal(patch.patchSource(applied.next).next, applied.next);
  for (const source of [pristine + pristine, pristine.replace('function rowToEntry(', 'function other('),
    pristine.replace('  ts INTEGER NOT NULL,', '  ts TEXT,'), pristine + '\n    listEntries() {}',
    applied.next.replace('durable-tier-inventory-unavailable', 'fabricated-success')]) assert(patch.patchSource(source).missing.length);
  const coherent = patchTieredMemorySource(pristine).next;
  assert.equal(patchTieredMemorySource(applied.next).next, patch.patchSource(coherent).next);
  assert.equal(patch.reverse(patch.patchSource(coherent).next), coherent);
  const bridgeBase = 'const operationContext = {};\nasync function withBridgeOperation() {}\nexport async function getControllerRegistry() {}\nfunction canonicalDbPath() {}\nfunction describeHierarchicalStore() {}\nfunction getHierarchicalFallback() {}\nexport async function bridgeStorePattern(options) {}\n// ===== Phase 4: Health check with attestation =====';
  const toolsBase = 'async function getBridge() {}\nexport const agentdbTools = [\n    agentdbHealth,\n];';
  const oldAddition = '\n    agentdbPatternList,\n    agentdbSkillList,\n    agentdbSkillGet,\n    agentdbHierarchicalStats,';
  for (const [base, previous] of [
    [bridgeBase, bridgeBase.replace('// ===== Phase 4', oldBridge + '// ===== Phase 4')],
    [toolsBase, toolsBase.replace('export const agentdbTools', oldTools + 'export const agentdbTools').replace('    agentdbHealth,', '    agentdbHealth,' + oldAddition)],
  ]) {
    assert.equal(patch.historicalPatchSource(base, previous).next, previous);
    assert.equal(patch.patchSource(previous).next, patch.patchSource(base).next);
    assert(patch.patchSource(previous.replace('invalid-inventory', 'altered-inventory')).missing.length);
  }
  const Store = await load(coherent, 'fixture');
  const db = fixtureDb(), owner = exercise(Store, db);
  const writes = db.writes;
  db.fail = true;
  assert.throws(() => owner.listEntries(), /denied/); assert.throws(() => owner.getEntry('missing'), /denied/);
  db.fail = false; assert.equal(db.writes, writes);
  // Native persist owns fixture writes; same-key nonarchived historical rows and
  // >5000 entries prove maps/caps cannot restrict the persisted inventory.
  for (let i = 0; i < 5010; i++) owner.persist({ id: 'fixture_' + String(i).padStart(5, '0'), key: 'duplicate-key', value: 'body_' + i, tier: 'working', ts: now }, false);
  owner.persist({ id: 'odd-archive', key: 'odd', value: 'ARCHIVED WITHOUT SUPERSEDES', tier: 'working', ts: now }, true);
  const rehydrated = new Store({ db });
  assert(rehydrated.getTierStats().working < 5010);
  logs.length = 0;
  const late = rehydrated.listEntries({ tier: 'working', offset: 5000, limit: 10, asOf: now });
  assert.equal(late.total, 5012); assert.equal(late.items.length, 10); assert.equal(new Set(late.items.map(row => row.id)).size, 10);
  assert(logs.filter(sql => sql.startsWith('SELECT id,')).length > 10);
  assert(logs.filter(sql => sql.startsWith('SELECT id,')).every(sql => !sql.includes('value') && /LIMIT 500$/.test(sql)));
  assert.equal(logs.filter(sql => sql.startsWith('SELECT *')).length, 10, 'only requested payloads fetched');
  assert.equal(rehydrated.getEntry('odd-archive', { asOf: now }).visibility.temporallyValid, true);
  assert.equal(rehydrated.getEntry('odd-archive', { asOf: now }).visibility.active, false);
  assert.equal(rehydrated.listEntries({ state: 'superseded', asOf: now }).total, 1);
  const completeValue = 'long original payload Ω\n'.repeat(7000);
  owner.persist({ id: 'large-original', key: 'large', value: completeValue, tier: 'semantic', ts: now }, false);
  assert.equal(rehydrated.getEntry('large-original').value, completeValue);
  assert.equal(rehydrated.listEntries({ tier: 'semantic' }).items.find(row => row.id === 'large-original').value, completeValue);
  const originalGet = rehydrated.getEntry;
  rehydrated.getEntry = () => null;
  assert.throws(() => rehydrated.listEntries(), /changed-during-read/);
  rehydrated.getEntry = (id, options) => ({ ...originalGet.call(rehydrated, id, options), tier: 'changed' });
  assert.throws(() => rehydrated.listEntries(), /changed-during-read/);
  rehydrated.getEntry = originalGet;
  db.rows.set('invalid-row', { id: null, ts: 0 });
  assert.throws(() => rehydrated.listEntries(), /invalid-native-tier-row/);
  db.rows.delete('invalid-row');
  // Optional actual installed class/SQLite binding qualification: only a new
  // disposable fixture DB is opened, never a managed memory file.
  const argv = process.argv.slice(2).filter(arg => !fs.existsSync(arg) || !fs.statSync(arg).isDirectory());
  if (argv.length) {
    assert.equal(argv[0], '--native-cli'); const req = createRequire(fs.realpathSync(argv[1]));
    const memory = req.resolve('@claude-flow/memory');
    const database = createRequire(createRequire(memory).resolve('agentdb'))('better-sqlite3');
    const nativePath = path.join(path.dirname(memory), 'tiered-memory.js');
    const Native = await load(fs.readFileSync(nativePath, 'utf8'), 'native');
    const fixturePath = path.join(scratch, 'private-fixture.db');
    const handle = new database(fixturePath);
    try {
      const native = exercise(Native, handle);
      for (let i = 0; i < 5010; i++) native.persist({ id: 'native_' + String(i).padStart(5, '0'), key: 'duplicate-key', value: 'payload_' + i, tier: 'working', ts: now + 1000000000000 }, false);
      const early = native.listEntries({ tier: 'working', limit: 2, asOf: now });
      const late = new Native({ db: handle }).listEntries({ tier: 'working', offset: 5000, limit: 2, asOf: now });
      assert.equal(early.total, 5011); assert.equal(late.total, 5011);
      assert.equal(early.items[0].id, 'native_05009'); assert.equal(late.items[0].id, 'native_00009');
      assert.equal(native.getEntry(late.items[0].id, { asOf: now }).value, late.items[0].value);
    } finally { handle.close(); }
    const restarted = new database(fixturePath);
    try {
      const reopened = new Native({ db: restarted });
      assert.equal(reopened.listEntries({ asOf: now }).total, 5015);
      assert.equal(reopened.getEntry('native_05009').value, 'payload_5009');
    } finally { restarted.close(); }
    console.log('PASS actual installed TieredMemoryStore + SQLite private fixture, 5010 duplicate-key rows, early/late page and exact payload');
  }
  console.log('PASS tier inventory: complete durable history, temporal filters, exact IDs, bounded metadata batches, native refusal, restart, legacy migration and coherence composition');
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
