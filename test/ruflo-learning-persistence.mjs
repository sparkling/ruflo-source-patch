import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { patchSource, reverse, isPatched, rspPatternFlushStatus } from '../lib/ruflo-learning-persistence/patcher.mjs';
import { FLUSH_VARIANTS } from '../lib/ruflo-learning-persistence/native.mjs';

const read = name => fs.readFileSync(new URL(`./fixtures/ruflo-learning-persistence/${name}.js`, import.meta.url), 'utf8');
const native = read('intelligence');
const hooks = read('post-command') + '\n' + read('other-callers');
const bridge = read('bridge-pattern');
const sha = s => createHash('sha256').update(s).digest('hex');
assert.deepEqual(FLUSH_VARIANTS.map(sha), [
  'ad31848617b9d9c2c0300d43c513221b5097640b851cd515ed5038adcf26b9b1',
  '1be9bd1738ae8d568baf3e3f5a7ae7c19311aad96914c5b6b970402f3b67a7ad',
]);

// The actual native functions run in a VM with only an in-memory fake disk.
// No imports, package initialization, real filesystem, root resolver or timers.
function runtime(source, fail = true) {
  const disk = new Map([['/virtual/patterns.json', JSON.stringify([{ id: 'other', content: 'other writer' }])]]);
  const state = { fail, writes: 0, statsWrites: 0, locks: 0, logs: [], counters: {} };
  const box = vm.createContext({ Date, Math, Map, Set, Array,
    console: { error: (...a) => state.logs.push(a), warn: () => {} },
    ensureDataDir: () => '/virtual', getPatternsPath: () => '/virtual/patterns.json',
    writeFileSync: (file, value) => { state.writes++; if (state.fail) throw Object.assign(Error('private diagnostic'), { code: 'ENOSPC' }); disk.set(file, value); },
    readFileSync: file => disk.get(file), existsSync: file => disk.has(file),
    renameSync: (from, to) => { if (!disk.has(from)) throw Error('missing fake source'); disk.set(to, disk.get(from)); disk.delete(from); },
    withStatsFileLock: (file, fn) => { state.locks++; fn(file); },
    process: { pid: 123 },
    sonaCoordinator: { recordTrajectory() {}, addTrajectoryStep() {}, async endTrajectory() {}, async distillLearning() {} },
    globalStats: {}, loadRuvllmCoordinator: async () => null,
    bumpStat: key => { state.counters[key] = (state.counters[key] || 0) + 1; },
    savePersistedStats: () => { state.statsWrites++; },
  });
  vm.runInContext(source.replaceAll('export ', '') + '\nglobalThis.bank = new LocalReasoningBank();', box, { timeout: 1000 });
  Object.assign(box.bank, { persistenceEnabled: true, dirty: false, patterns: new Map(), patternList: [],
    dirtyIds: new Set(), deletedIds: new Set(), clearRequested: false,
    store(p) { this.patternList.push(p); this.patterns.set(p.id, p); this.dirtyIds.add(p.id); this.dirty = true; return true; },
    findSimilar() { return []; },
  });
  box.reasoningBank = box.bank;
  return { box, state, disk,
    record: () => box.recordTrajectory([{ type: 'action', content: 'isolated test', embedding: [0.1] }], 'success') };
}
const original = runtime(native);
assert.equal(await original.record(), true, 'reproduce native successful result despite ENOSPC');
assert.equal(original.box.bank.dirty, true);
assert.equal(original.state.counters.trajectoriesRecorded, 1);
assert.equal(original.state.logs.length, 1);

for (const flush of FLUSH_VARIANTS) {
  const source = native.replace(FLUSH_VARIANTS[0], flush);
  const fixed = patchSource(source);
  assert.deepEqual(fixed.missing, []);
  assert(isPatched(fixed.next));
  assert.equal(reverse(fixed.next), source);
  assert.equal(patchSource(fixed.next).next, fixed.next);
  const run = runtime(fixed.next);
  const before = run.disk.get('/virtual/patterns.json');
  assert.equal(await run.record(), false, 'failed flush must not acknowledge trajectory persistence');
  assert.equal(run.box.bank.dirty, true);
  assert.equal(run.box.bank.patternList.length, 1, 'unsaved learning stays in the owner');
  assert.equal(run.state.counters.trajectoriesRecorded || 0, 0);
  assert.equal(run.state.statsWrites, 0);
  assert.equal(run.disk.get('/virtual/patterns.json'), before);
  assert.equal(run.box.bank.rspPatternFlush.success, false);
  assert.equal(run.box.bank.rspPatternFlush.code, 'ENOSPC');
  assert.equal(run.box.bank.flushToDisk(), false, 'timer-style invocation does not throw');
  const status = rspPatternFlushStatus(run.box.bank);
  assert(status.dirty); assert.equal(status.lastFlush.code, 'ENOSPC');
  assert(!JSON.stringify(status).includes('private diagnostic'));
  status.lastFlush.code = 'CHANGED';
  assert.equal(run.box.bank.rspPatternFlush.code, 'ENOSPC', 'status does not expose a mutable internal receipt');
  run.state.fail = false;
  assert.equal(run.box.bank.flushToDisk(), true, 'same in-memory owner can flush through native path');
  assert.equal(run.box.bank.dirty, false);
  assert.equal(run.box.bank.rspPatternFlush.success, true);
  assert.equal(run.box.bank.rspPatternFlush.code, null);
  const written = JSON.parse(run.disk.get('/virtual/patterns.json'));
  assert(written.some(p => p.content === 'isolated test'));
  if (flush === FLUSH_VARIANTS[1]) {
    assert(written.some(p => p.id === 'other'), 'preserve native locked merge');
    assert(run.state.locks > 0);
  }
  const writes = run.state.writes;
  assert.equal(run.box.bank.flushToDisk(), true);
  assert.equal(run.state.writes, writes, 'clean native bank does not write again');
  run.box.bank.persistenceEnabled = false;
  assert.equal(run.box.bank.flushToDisk(), false, 'disabled persistence is not confirmed');
  for (const damaged of [fixed.next + fixed.next, fixed.next.replace('return false;', 'return true;'),
    source.replace('writeFileSync(', 'unqualifiedWriter(')]) {
    assert(patchSource(damaged).missing.length);
    assert.equal(patchSource(damaged).next, damaged);
  }
}
assert.equal(rspPatternFlushStatus(null).dirty, null, 'fresh process does not prove older owner clean');

async function command(source, intel) {
  const box = vm.createContext({ Date, Math, Number, process: { env: {} },
    validateText: () => ({ valid: true }), recordCommandOutcome() {}, commandRecordingDisabled: () => false,
    getProjectCwd: () => '/virtual', redactCommandForStorage: x => x,
    bridge: { bridgeStoreEntry: async () => ({ success: true }) }, intel,
  });
  const safe = source.replaceAll('export ', '')
    .replaceAll("await import('../memory/memory-bridge.js')", 'bridge')
    .replaceAll("await import('../memory/intelligence.js')", 'intel');
  // Alias dependencies before handler-local variables use the same names.
  const body = safe.replace('const bridge = bridge;', 'const bridge = globalThis.bridge;')
    .replaceAll('const intel = intel;', 'const intel = globalThis.intel;');
  vm.runInContext(body + '\nglobalThis.command = hooksPostCommand.handler;', box, { timeout: 1000 });
  return box.command({ command: 'inert', exitCode: 0 });
}
const fixedHooks = patchSource(hooks);
assert.deepEqual(fixedHooks.missing, []);
assert(isPatched(fixedHooks.next));
assert.equal(reverse(fixedHooks.next), hooks);
let count = 0;
const falseIntel = { recordTrajectory: async () => { count++; return false; }, getIntelligenceStats: () => ({ trajectoriesRecorded: count }) };
assert.equal((await command(hooks, falseIntel)).learningPath, 'trajectory-pipeline', 'native caller ignores false');
assert.equal((await command(fixedHooks.next, falseIntel)).learningPath, 'recorded-only');
const trueIntel = { recordTrajectory: async () => { count++; return true; }, getIntelligenceStats: () => ({ trajectoriesRecorded: count }) };
assert.equal((await command(fixedHooks.next, trueIntel)).learningPath, 'trajectory-pipeline', 'helper must call native method, not recurse');
assert.equal((await command(fixedHooks.next, falseIntel)).recorded, true, 'independent command storage remains successful');

async function storePattern(source, flush) {
  let stores = 0;
  const bank = { store: () => { stores++; }, findSimilar() {}, flushToDisk: flush };
  const box = vm.createContext({ operationContext: { getStore: () => ({ active: true }) },
    getRegistry: async () => new Map([['reasoningBank', bank]]), generateId: () => 'test-pattern',
    initializer: { generateEmbedding: async () => ({ embedding: [0.2] }) },
  });
  vm.runInContext(source.replaceAll('export ', '').replace("await import('./memory-initializer.js')", 'initializer'), box);
  const result = await box.bridgeStorePattern({ pattern: 'inert', type: 'test', confidence: 0.8 });
  return { result, stores };
}
const fixedBridge = patchSource(bridge);
assert.deepEqual(fixedBridge.missing, []); assert(isPatched(fixedBridge.next));
assert.equal(reverse(fixedBridge.next), bridge);
assert.equal((await storePattern(bridge, () => false)).result.success, true, 'native bridge ignores flush failure');
const failedBridge = await storePattern(fixedBridge.next, () => false);
assert.equal(failedBridge.result.success, false); assert.equal(failedBridge.stores, 1);
assert.equal((await storePattern(fixedBridge.next, () => true)).result.success, true);
assert.equal((await storePattern(fixedBridge.next, () => undefined)).result.success, true, 'unmodified external controller contract retained');
console.log('PASS native learning persistence: failure propagation, dirty state, timer safety, native merge, caller/bridge guards, exact reversal');
