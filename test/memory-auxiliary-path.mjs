// Execute pristine/native function bodies with disposable stores and driver doubles.
// No managed database or standalone vector file is opened by this regression.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-auxiliary-path-'));
process.env.RUFLO_SOURCE_PATCH_HOME = path.join(scratch, 'home');
process.env.RUFLO_NPX_ROOT = path.join(scratch, 'npx');
process.env.RUFLO_GLOBAL_ROOT = path.join(scratch, 'global');
process.env.RSP_NO_STALE_WRITER_KILL = '1';
process.env.RSP_NO_HOST_AUTO_UPDATE = '1';
const { findVendorRootWith, pristineBytes } = await import('./fixtures.mjs');
const patchLib = await import('../lib/cwd/patch-library.mjs');
const { memoryAuxiliaryPathEntry: initEntry, memoryPatternAuxiliaryPathEntry: patternEntry,
  nativeControllerPathSatisfied } = await import('../lib/cwd/memory-mcp-path.mjs');
const patternPatch = await import('../lib/ruflo-pattern-receipt/bridge.mjs');
const vendor = findVendorRootWith('dist/src/memory/memory-initializer.js', [
  'export async function addToHNSWIndex(id, embedding, entry) {',
  '                removeHNSWEntriesByKey(options.key, ns);',
]);
const read = name => pristineBytes(path.join(vendor, '@claude-flow/cli/dist/src/memory', name)).toString();
const initSource = read('memory-initializer.js'), bridgeSource = read('memory-bridge.js');
const render = (source, entry) => {
  const result = patchLib.composeCliContribution(source, [entry]);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.applied, [entry.id]);
  return result.next;
};
const patchedInit = render(initSource, initEntry), patchedBridge = render(bridgeSource, patternEntry);
const body = (source, name) => {
  const match = source.match(new RegExp('(?:export )?(?:async )?function ' + name + '\\([^]*?^}', 'm'));
  assert(match, 'native function missing: ' + name);
  return match[0].replace(/^export /, '');
};
const A = path.join(scratch, 'ambient', '.swarm', 'agentdb-memory.db');
const ordinaryA = path.join(path.dirname(A), 'memory.db');
const B = path.join(scratch, 'authoritative', 'memory.db');
for (const file of [A, B]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'disposable sentinel, not a database');
}

function harness(initializer, bridgeText, { fail = null, raw = false } = {}) {
  const stores = new Map([[A, new Map()], [ordinaryA, new Map()], [B, new Map()]]), events = [];
  const hnswIndex = { entries: new Map([['ambient-vector', { key: 'same', namespace: 'test', content: 'A survives' }]]) };
  const slot = (key, namespace) => namespace + '/' + key;
  const rows = dbPath => stores.get(dbPath ?? A);
  let nextId = 0, primaryReceipt;
  class Driver {
    constructor(dbPath) { this.dbPath = dbPath; }
    prepare(sql) {
      let bound, stepped = false;
      return {
        run: (...args) => this.run(sql, args),
        all: () => [],
        bind: args => { bound = args; },
        step: () => !stepped && (stepped = true) && rows(this.dbPath).has(slot(...bound)),
        get: (...args) => args.length ? rows(this.dbPath).get(slot(args[1], args[0])) : ['existing-id'],
        free() {},
      };
    }
    run(sql, args = []) {
      if (/INSERT(?: OR REPLACE)? INTO memory_entries/.test(sql)) {
        const [id, key, namespace, content, embedding, dimensions] = args;
        const previous = rows(this.dbPath).get(slot(key, namespace));
        rows(this.dbPath).set(slot(key, namespace), { ...previous, id, key, namespace, content,
          embedding: JSON.parse(embedding), dimensions });
        events.push(['write', this.dbPath, key]);
      } else if (/UPDATE memory_entries/.test(sql)) rows(this.dbPath).delete(slot(...args));
      else if (/DELETE FROM memory_entries/.test(sql)) {
        for (const [key, value] of rows(this.dbPath)) if (value.namespace === args[0]) rows(this.dbPath).delete(key);
      }
      return { changes: 1 };
    }
    exec() { return [{ values: [[rows(this.dbPath).size]] }]; }
    export() { return 'fixture export'; }
    close() {}
    pragma() {}
  }
  const getRegistry = async dbPath => {
    events.push(['registry', dbPath ?? A]);
    return { dbPath: dbPath ?? A, get: () => null };
  };
  const nativeBridgeDeps = {
    operationContext: { getStore: () => ({ active: true }) }, getRegistry,
    getDb: registry => ({ db: new Driver(registry.dbPath), agentdb: {} }),
    isValidProvenanceType: () => true, generateId: () => 'entry-' + ++nextId,
    guardValidate: async () => ({ allowed: true }), embedForBridge: async () => ({ vector: [0.25, 0.75], model: 'fixture' }),
    bridgeFailureReasons: new Map(), canonicalDbPath: value => value ?? A,
    entryCacheKey: slot, cacheInvalidate: async () => {}, logAttestation: async () => {},
  };
  const nativeBridge = new Function(...Object.keys(nativeBridgeDeps),
    body(bridgeText, 'bridgeStoreEntry') + '\n' + body(bridgeText, 'bridgeAddEmbedding')
    + '\nreturn {bridgeStoreEntry,bridgeAddEmbedding};')(...Object.values(nativeBridgeDeps));
  const bridge = {
    bridgeStoreEntry: async options => {
      if (raw) return null;
      events.push(['primary', options.dbPath ?? A]);
      return primaryReceipt = await nativeBridge.bridgeStoreEntry(options);
    },
    bridgeAddEmbedding: async (...args) => {
      events.push(['auxiliary', args[3]]);
      if (fail === 'throw') throw Error('fixture auxiliary unavailable');
      if (fail === 'false') return false;
      if (fail === 'null') return null;
      return nativeBridge.bridgeAddEmbedding(...args);
    },
    bridgeDeleteEntry: async options => raw ? null : { success: true,
      deleted: rows(options.dbPath).delete(slot(options.key, options.namespace ?? 'default')) },
    bridgePurgeNamespace: async options => {
      if (raw) return null;
      let deletedCount = 0;
      for (const [key, value] of rows(options.dbPath)) if (value.namespace === options.namespace) {
        rows(options.dbPath).delete(key); deletedCount++;
      }
      return { success: true, deletedCount };
    },
  };
  const deps = { path, fs, hnswIndex,
    getBridge: async () => fail === 'absent' ? null : bridge,
    getHNSWIndex: async () => { events.push(['ambient-index']); return { ...hnswIndex,
      db: { insert: async () => events.push(['ambient-insert']) } }; },
    saveHNSWMetadata: () => events.push(['ambient-save']), rebuildSearchIndex: () => events.push(['ambient-rebuild']),
    isValidProvenanceType: () => true, getMemoryRoot: () => path.dirname(A),
    releaseOwnNativeHandle: async () => {}, hasNativeWalSidecars: async () => false,
    generateEmbedding: async () => ({ embedding: [0.25, 0.75], dimensions: 2, model: 'fixture' }),
    withMemoryDbLock: async (_dbPath, fn) => fn(), ensureSchemaColumns: async () => {},
    initFixtureSql: async () => ({ Database: Driver }), readFileMaybeEncrypted: file => file,
    writeDbImagePreservingFormat: dbPath => events.push(['primary-export', dbPath]),
    ACTIVE_MEMORY_ROW_SQL: "status = 'active'", validateIdentifier: () => ({ valid: true }),
  };
  const code = ['removeHNSWEntriesByLogicalKey', 'removeHNSWEntriesByKey', 'addToHNSWIndex',
    'storeEntry', 'deleteEntry', 'purgeNamespace'].map(name => body(initializer, name)).join('\n')
    .replaceAll("(await import('sql.js')).default", 'initFixtureSql');
  const api = new Function(...Object.keys(deps), code
    + '\nreturn {addToHNSWIndex,storeEntry,deleteEntry,purgeNamespace};')(...Object.values(deps));
  const patternDeps = { ...nativeBridgeDeps, bridgeStoreEntry: bridge.bridgeStoreEntry,
    initializer: api };
  api.bridgeStorePattern = new Function(...Object.keys(patternDeps),
    body(bridgeText, 'bridgeStorePattern').replaceAll("await import('./memory-initializer.js')", 'initializer')
    + '\nreturn bridgeStorePattern;')(...Object.values(patternDeps));
  return { api, stores, events, hnswIndex, rows, receipt: () => primaryReceipt };
}

const options = { key: 'same', namespace: 'test', value: 'B only', dbPath: B, upsert: true };
const ambientEffects = h => h.events.filter(event => event[0].startsWith('ambient-'));
try {
  const baseline = harness(initSource, bridgeSource);
  assert.equal((await baseline.api.storeEntry(options)).success, true);
  assert.equal(baseline.rows(A).get('test/same').content, 'B only', 'pristine must reproduce the wrong-store write');
  assert.equal(baseline.hnswIndex.entries.has('ambient-vector'), false, 'pristine also invalidates A');

  for (const fail of [null, 'false', 'null', 'throw']) {
    const h = harness(patchedInit, patchedBridge, { fail });
    const result = await h.api.storeEntry(options);
    assert.equal(result, h.receipt(), 'preserve native committed receipt exactly');
    assert.equal(result.success, true);
    assert.deepEqual(h.rows(B).get('test/same').embedding, [0.25, 0.75]);
    assert.equal(h.rows(A).size, 0);
    assert.equal(h.hnswIndex.entries.has('ambient-vector'), true);
    assert.deepEqual(ambientEffects(h), []);
    assert.deepEqual(h.events.filter(e => e[0] === 'auxiliary'), [['auxiliary', B]]);
    assert.equal(h.events.filter(e => e[0] === 'primary').length, 1, 'never replay a committed primary write');
    assert.equal((await h.api.deleteEntry(options)).deleted, true);
    assert.equal(h.hnswIndex.entries.has('ambient-vector'), true, 'explicit delete leaves A searchable');
    await h.api.storeEntry(options);
    assert.equal((await h.api.purgeNamespace(options)).deletedCount, 1);
    assert.equal(h.hnswIndex.entries.has('ambient-vector'), true, 'explicit purge leaves A searchable');
    assert.deepEqual(ambientEffects(h), []);
  }
  for (const fail of ['false', 'null', 'throw', 'absent']) {
    const h = harness(patchedInit, patchedBridge, { fail });
    assert.equal(await h.api.addToHNSWIndex('aux', [1, 0], options, B), false);
    assert.deepEqual(ambientEffects(h), []);
    assert.equal(h.rows(A).size, 0);
  }
  for (const fail of [null, 'false', 'throw']) {
    const h = harness(patchedInit, patchedBridge, { fail, raw: true });
    assert.equal((await h.api.storeEntry(options)).success, true, 'raw primary commit is not reclassified on secondary failure');
    assert.equal(h.rows(B).get('test/same').content, options.value);
    assert.equal(h.rows(A).size, 0);
    assert.equal((await h.api.deleteEntry(options)).deleted, true);
    await h.api.storeEntry(options);
    assert.equal((await h.api.purgeNamespace(options)).success, true);
    assert.equal(h.hnswIndex.entries.has('ambient-vector'), true);
    assert.deepEqual(ambientEffects(h), []);
  }
  for (const fail of [null, 'false', 'throw']) {
    const pattern = harness(patchedInit, patchedBridge, { fail });
    assert.equal((await pattern.api.bridgeStorePattern({ pattern: 'pattern B', type: 'test', dbPath: B })).success, true);
    assert.equal(pattern.rows(A).size, 0);
    assert.equal(pattern.rows(B).size, 1);
    assert.deepEqual(pattern.events.filter(e => e[0] === 'auxiliary'), [['auxiliary', B]]);
    assert.deepEqual(ambientEffects(pattern), []);
  }
  for (const fail of [null, 'false', 'null', 'absent']) {
    const h = harness(patchedInit, patchedBridge, { fail });
    assert.equal(await h.api.addToHNSWIndex('implicit', [1, 0], options), true);
    if (fail) assert(ambientEffects(h).length > 0, 'implicit fallback remains native');
    else assert.equal(h.rows(A).size, 1, 'implicit bridge still chooses native A');
  }
  const implicit = harness(patchedInit, patchedBridge);
  await implicit.api.storeEntry({ ...options, dbPath: undefined });
  assert.equal(implicit.hnswIndex.entries.has('ambient-vector'), false, 'implicit invalidation stays native');
  for (const operation of ['deleteEntry', 'purgeNamespace']) {
    const h = harness(patchedInit, patchedBridge);
    // Native purge resolves the ordinary default; implicit controller deletion
    // retains AgentDB's independent default. Preserve both upstream contracts.
    const owner = operation === 'purgeNamespace' ? ordinaryA : A;
    h.rows(owner).set('test/same', { key: 'same', namespace: 'test' });
    await h.api[operation]({ ...options, dbPath: undefined });
    assert.equal(h.rows(owner).size, 0);
    assert.equal(h.hnswIndex.entries.has('ambient-vector'), false, 'implicit deletion stays native');
    assert(ambientEffects(h).length > 0);
  }
  await assert.rejects(harness(patchedInit, patchedBridge, { fail: 'throw' }).api
    .addToHNSWIndex('implicit', [1, 0], options), /fixture auxiliary unavailable/);
  assert.equal(nativeControllerPathSatisfied(bridgeSource), true);
  assert.equal(body(patchedBridge, 'getAgentDbPath'), body(bridgeSource, 'getAgentDbPath'), 'controller ownership is byte-identical');

  // Real shared composition: ordinary memory and pattern receipt survive either removal order.
  const nodeModules = path.join(process.env.RUFLO_NPX_ROOT, 'fixture/node_modules');
  const initFile = path.join(nodeModules, ...initEntry.suffix), bridgeFile = path.join(nodeModules, ...patternEntry.suffix);
  for (const [file, source] of [[initFile, initSource], [bridgeFile, bridgeSource]]) {
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, source);
  }
  const { applyComposed } = await import('../lib/plugin-compose.mjs');
  const apply = targets => applyComposed(targets.filter(target => target !== 'memory'), {
    cliTargets: targets.filter(target => target === 'memory'), files: [initFile, bridgeFile],
  });
  for (const order of [['memory', 'ruflo-pattern-receipt'], ['ruflo-pattern-receipt', 'memory']]) {
    const result = apply(order);
    assert.equal(result.errors, 0, JSON.stringify(result));
    assert.equal(result.incomplete, 0, JSON.stringify(result));
    assert(patternPatch.isBridgePatched(fs.readFileSync(bridgeFile, 'utf8')));
    assert(fs.readFileSync(bridgeFile, 'utf8').includes(patternEntry.edits[0].replace));
    const status = patchLib.inspect().memory;
    assert.equal(status.satisfied, status.files, JSON.stringify(status));
    assert.equal(apply(order).patched, 0);
    const survivor = [order[1]];
    assert.equal(apply(survivor).errors, 0);
    assert.equal(fs.readFileSync(bridgeFile, 'utf8').includes(patternEntry.edits[0].replace), survivor[0] === 'memory');
    assert.equal(patternPatch.isBridgePatched(fs.readFileSync(bridgeFile, 'utf8')), survivor[0] === 'ruflo-pattern-receipt');
    apply([]);
    assert.equal(fs.readFileSync(initFile, 'utf8'), initSource);
    assert.equal(fs.readFileSync(bridgeFile, 'utf8'), bridgeSource);
  }
  for (const [source, entry] of [[initSource, initEntry], [bridgeSource, patternEntry]]) {
    for (const edit of entry.edits) {
      // A changed literal must be refused before any edit in this entry is applied.
      const changed = source.replace(edit.find, edit.find.replace(/[a-z](?=[^a-z]*$)/, 'X'));
      const result = patchLib.composeCliContribution(changed, [entry]);
      assert(result.missing.length > 0, 'foreign anchor drift refused');
      assert.equal(result.next, changed);
      const ambiguous = source + '\n' + edit.find;
      const refused = patchLib.composeCliContribution(ambiguous, [entry]);
      assert(refused.missing.length > 0, 'duplicate anchor refused');
      assert.equal(refused.next, ambiguous);
    }
  }
  for (const file of [A, B]) assert.equal(fs.readFileSync(file, 'utf8'), 'disposable sentinel, not a database');
  console.log('memory auxiliary explicit-path regression passed (native bodies, A/B isolation, failure, deletion, composition)');
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
