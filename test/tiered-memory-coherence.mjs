import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { COHERENCE_EDITS, patchTieredMemorySource } from '../lib/cwd/tiered-memory-coherence.mjs';

const args = process.argv.slice(2);
if (args[0] && path.isAbsolute(args[0]) && !args[0].endsWith('package.json'))
  assert.ok(fs.statSync(args.shift()).isDirectory());
assert.ok(args.length === 0 || (args.length === 2 && args[0] === '--native-cli' && path.isAbsolute(args[1])));
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-tier-coherence-')));
process.env.RUFLO_SOURCE_PATCH_HOME = scratch;
process.env.RUFLO_NPX_ROOT = path.join(scratch, 'npx');
process.env.RUFLO_GLOBAL_ROOT = path.join(scratch, 'global');
const pristine = fs.readFileSync(new URL('./fixtures/tiered-memory/native-3.0.0.mjs', import.meta.url), 'utf8');
const patched = patchTieredMemorySource(pristine);
const originalFile = path.join(scratch, 'original.mjs');
const patchedFile = path.join(scratch, 'patched.mjs');
fs.writeFileSync(originalFile, pristine);
fs.writeFileSync(patchedFile, patched.next);
const episode = JSON.stringify({ task: 'verified fixture episode', success: true, reward: 0.75, critique: 'fixture only' });

// This injected adapter is a test fixture, never a connection to managed memory.
// Native SQLite and separate-process coverage are additionally required below
// when an installed CLI is selected by the caller.
function fixtureDb() {
  const rows = new Map();
  return {
    failReads: false,
    failDecoding: false,
    writes: 0,
    exec() {},
    prepare(sql) {
      if (sql.startsWith('SELECT *')) return { all: () => {
        if (this.failReads) throw new Error('fixture read unavailable');
        const snapshot = [...rows.values()].map(row => ({ ...row })).sort((a, b) => a.ts - b.ts);
        if (this.failDecoding) snapshot.push(Object.defineProperty({}, 'id', {
          get() { throw new Error('fixture row decoding unavailable'); },
        }));
        return snapshot;
      } };
      if (sql.startsWith('SELECT COUNT')) return { get: () => ({ n: rows.size }) };
      if (sql.startsWith('INSERT')) return { run: (...values) => {
        this.writes++;
        const names = ['id', 'key', 'value', 'tier', 'ts', 'valid_from', 'valid_until', 'superseded_by', 'archived'];
        rows.set(values[0], Object.fromEntries(names.map((name, index) => [name, values[index]])));
      } };
      if (sql.startsWith('DELETE')) return { run: id => { this.writes++; rows.delete(id); } };
      throw new Error(`unexpected fixture operation: ${sql}`);
    },
  };
}
function exercise(Store, db) {
  const reader = new Store({ db });
  const writer = new Store({ db });
  assert.deepEqual(reader.recall('episode'), []);
  writer.store('episode', episode, 'episodic');
  assert.equal(reader.recall('episode')[0]?.value, episode, 'older reader sees later writer');
  assert.equal(reader.getTierStats().episodic, 1);
  reader.store('episode', 'replacement', 'episodic');
  assert.equal(writer.recall('episode')[0].value, 'replacement');
  assert.equal(writer.countPersisted(), 1, 'cross-reader same-key replacement leaves one active row');
  writer.store('policy', 'old policy', 'semantic');
  reader.store('policy-next', 'new policy', 'semantic', { supersedes: 'policy' });
  assert.deepEqual(writer.recall('policy', 10).map(row => row.value), ['new policy']);
  for (let count = 0; count < 3; count++) {
    assert.equal(writer.recall('policy', 10, { includeExpired: true }).length, 2);
    assert.equal(writer.getTierStats().superseded, 1, 'refresh does not append duplicate history');
  }
  assert.equal(reader.remove('episode'), true);
  assert.deepEqual(writer.recall('episode'), [], 'later deletion removes old reader cache entry');
  writer.store('future', 'future policy', 'working', { validFrom: '2999-01-01T00:00:00.000Z' });
  assert.deepEqual(reader.recall('future'), []);
  assert.equal(reader.recall('future', 5, { includeExpired: true }).length, 1);
  return { reader, writer };
}
try {
  assert.deepEqual(patched.missing, []);
  assert.equal(patchTieredMemorySource(patched.next).next, patched.next);
  let restored = patched.next;
  for (const edit of [...COHERENCE_EDITS].reverse()) restored = restored.replace(edit.replace, edit.find);
  assert.equal(restored, pristine);
  assert.ok(patchTieredMemorySource('unrecognised native bytes').missing.length);
  assert.ok(patchTieredMemorySource(pristine + '\n' + COHERENCE_EDITS[0].find).missing.length);
  const Original = (await import(pathToFileURL(originalFile))).TieredMemoryStore;
  const Current = (await import(pathToFileURL(patchedFile))).TieredMemoryStore;
  const baselineDb = fixtureDb();
  const oldReader = new Original({ db: baselineDb });
  const oldWriter = new Original({ db: baselineDb });
  oldWriter.store('episode', episode, 'episodic');
  assert.deepEqual(oldReader.recall('episode'), [], 'unpatched source reproduces the observed failure');
  const db = fixtureDb();
  const { reader } = exercise(Current, db);
  const before = db.writes;
  db.failReads = true;
  assert.throws(() => reader.recall('policy'), /fixture read unavailable/, 'failure must not return stale results');
  assert.throws(() => reader.getTierStats(), /fixture read unavailable/);
  assert.throws(() => reader.store('blocked', 'unacknowledged'), /fixture read unavailable/);
  assert.equal(db.writes, before, 'failed refresh does not mutate persisted state');
  db.failReads = false;
  assert.equal(reader.recall('policy')[0].value, 'new policy');
  const tiersBefore = reader.tiers;
  const archiveBefore = reader.archived;
  db.failDecoding = true;
  assert.throws(() => reader.recall('policy'), /fixture row decoding unavailable/);
  assert.equal(reader.tiers, tiersBefore, 'partial decoding must not replace active views');
  assert.equal(reader.archived, archiveBefore, 'partial decoding must not replace retained history');
  db.failDecoding = false;
  const volatile = new Current();
  volatile.store('local', 'volatile value');
  assert.equal(volatile.recall('local')[0].value, 'volatile value');
  assert.equal(volatile.isDurable(), false);
  // Existing target engine owns installation, backup, idempotence and restoration.
  const target = path.join(process.env.RUFLO_GLOBAL_ROOT, '@claude-flow', 'memory', 'dist', 'tiered-memory.js');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, pristine);
  const { apply } = await import('../lib/cwd/patch-library.mjs');
  assert.equal(apply(['memory']).patched, 1);
  assert.equal(apply(['memory']).patched, 0);
  assert.equal(apply([]).restored, 1);
  assert.equal(fs.readFileSync(target, 'utf8'), pristine);
  // Neither a mutation driver nor SQL diagnostic against any managed DB is used:
  // only this suite's new private fixture file, using public TieredMemoryStore APIs.
  if (args[1]) {
    const cliPackage = fs.realpathSync(args[1]);
    assert.equal(JSON.parse(fs.readFileSync(cliPackage, 'utf8')).name, '@claude-flow/cli');
    const memoryEntry = createRequire(cliPackage).resolve('@claude-flow/memory');
    const agentEntry = createRequire(memoryEntry).resolve('agentdb');
    const databaseModule = createRequire(agentEntry).resolve('better-sqlite3');
    const Database = createRequire(agentEntry)('better-sqlite3');
    const nativeFile = path.join(path.dirname(memoryEntry), 'tiered-memory.js');
    const native = fs.readFileSync(nativeFile, 'utf8');
    const nativePatch = patchTieredMemorySource(native);
    assert.deepEqual(nativePatch.missing, []);
    fs.writeFileSync(path.join(scratch, 'native-patched.mjs'), nativePatch.next);
    const NativeStore = (await import(pathToFileURL(path.join(scratch, 'native-patched.mjs')))).TieredMemoryStore;
    const sharedFile = path.join(scratch, 'private-native-fixture.db');
    const handle = new Database(sharedFile);
    try {
      const parent = new NativeStore({ db: handle });
      assert.deepEqual(parent.recall('episode'), []);
      const code = `import { createRequire } from 'node:module';
import { TieredMemoryStore } from ${JSON.stringify(pathToFileURL(path.join(scratch, 'native-patched.mjs')).href)};
const Database = createRequire(import.meta.url)(${JSON.stringify(databaseModule)});
const db = new Database(${JSON.stringify(sharedFile)});
try { const store = new TieredMemoryStore({db}); store.store('episode', ${JSON.stringify(episode)}, 'episodic'); }
finally { db.close(); }`;
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 10000 });
      assert.equal(child.status, 0, child.stderr);
      assert.equal(parent.recall('episode')[0]?.value, episode, 'native child write visible to already-open parent');
      assert.equal(parent.getTierStats().episodic, 1);
      // Consumer verification uses the installed pure context synthesizer.
      const synthPath = createRequire(cliPackage).resolve('agentdb/controllers/ContextSynthesizer');
      const { ContextSynthesizer } = await import(pathToFileURL(synthPath));
      const result = ContextSynthesizer.synthesize(parent.recall('episode').map(row => JSON.parse(row.value)));
      assert.equal(result.totalMemories, 1);
      assert.equal(result.averageReward, 0.75);
      assert.equal(result.successRate, 1);
      parent.remove('episode');
      exercise(NativeStore, handle);
    } finally { handle.close(); }
    console.log('PASS native child-process write, existing-reader recall and installed context consumer');
  }
  console.log('PASS tiered-memory coherence: stale-reader reproduction, replacement, deletion, temporal history, fail-closed refresh, volatile mode and target restoration');
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
