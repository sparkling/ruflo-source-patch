import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { CONTEXT_OLD, CONTEXT_351, CONTEXT_PREVIOUS, CONTEXT_RELEASED, CONTEXT_NEW,
  CONTEXT_NATIVE_HELPERS, nativeContextSatisfied, contextWithLease } from '../lib/ruflo-context-contract/patcher.mjs';
const argv = process.argv.slice(2);
if (argv[0] && path.isAbsolute(argv[0]) && !argv[0].endsWith('package.json')) argv.shift();
assert.ok(!argv.length || (argv.length === 2 && argv[0] === '--native-cli'));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-native-context-'));
process.env.RUFLO_SOURCE_PATCH_HOME = scratch;
process.env.RUFLO_NPX_ROOT = path.join(scratch, 'npx');
process.env.RUFLO_GLOBAL_ROOT = path.join(scratch, 'global');
const root = path.join(scratch, 'global/@claude-flow/cli');
const file = path.join(root, 'dist/src/memory/memory-bridge.js');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(path.join(root, 'package.json'), '{"name":"@claude-flow/cli","version":"3.71.1","type":"module"}');
const prelude = `let registry;
export function setRegistry(value) { registry = value; }
async function getRegistry() { return registry; }
const operationContext = { getStore: () => ({ active: true }) };
function withBridgeOperation() { throw Error('lost native lease'); }
`;
const pristine = prelude + CONTEXT_NATIVE_HELPERS + CONTEXT_351 + '\n';
const { apply, inspect } = await import('../lib/cwd/patch-library.mjs');
const { checkNativeContext } = await import('../lib/ruflo-context-contract/supersede.mjs');
try {
  fs.writeFileSync(file, pristine);
  assert.equal(apply(['ruflo-context-contract']).incomplete, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), pristine);
  assert.equal(inspect()['ruflo-context-contract'].native, 1);
  assert.equal(checkNativeContext().state, 'superseded');
  for (const former of [CONTEXT_PREVIOUS, CONTEXT_RELEASED, CONTEXT_NEW]) {
    fs.writeFileSync(file + '.rsp-backup', pristine);
    fs.writeFileSync(file, '\n' + pristine.replace(CONTEXT_351, () => contextWithLease(former)));
    assert.equal(apply(['ruflo-context-contract']).incomplete, 0, 'released current overlay upgrades');
    assert.equal(fs.readFileSync(file, 'utf8'), pristine, 'exact published restoration');
    assert.equal(apply(['ruflo-context-contract']).incomplete, 0, 'monitor/all cannot re-add it');
  }
  for (const unknown of [prelude + CONTEXT_OLD, pristine.replace("typeof record.success !== 'boolean'", "typeof record.success !== 'string'"),
    pristine.replace("reason: 'no-memories'", "reason: 'unknown'"), pristine + pristine]) {
    fs.rmSync(file + '.rsp-backup', { force: true }); fs.writeFileSync(file, unknown);
    assert.equal(nativeContextSatisfied(unknown), false);
    assert.ok(apply(['ruflo-context-contract']).incomplete);
    assert.equal(fs.readFileSync(file, 'utf8'), unknown, 'unqualified native is never rewritten');
    assert.notEqual(checkNativeContext().state, 'superseded');
  }
  // Explicit removal of exact historical old overlays remains available. It is
  // not an installation or a declaration that the historical native bug is fixed.
  const old = prelude + CONTEXT_OLD + '\n';
  for (const former of [CONTEXT_PREVIOUS, CONTEXT_RELEASED, CONTEXT_NEW]) {
    fs.writeFileSync(file + '.rsp-backup', old); fs.writeFileSync(file, '\n' + prelude + former + '\n');
    apply([]); assert.equal(fs.readFileSync(file, 'utf8'), old);
  }
  // Native upstream update must never be overwritten by an old saved original.
  fs.writeFileSync(file, pristine); fs.writeFileSync(file + '.rsp-backup', old);
  assert.equal(apply(['ruflo-context-contract']).incomplete, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), pristine);
  fs.writeFileSync(file + '.rsp-backup', old);
  const { addTargets, readState } = await import('../lib/cwd/state.mjs');
  const { retireSuperseded } = await import('../lib/supersede.mjs');
  addTargets(['ruflo-context-contract']);
  assert.equal(retireSuperseded(readState()).retired, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), pristine);
  const { PATCH_MARKER } = await import('../lib/cwd/paths.mjs');
  const foreignNative = '// ' + PATCH_MARKER + '\n' + pristine;
  fs.writeFileSync(file, foreignNative); fs.writeFileSync(file + '.rsp-backup', old);
  addTargets(['ruflo-context-contract']);
  assert.equal(retireSuperseded(readState()).retired, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), foreignNative, 'unknown core marker cannot license a downgrade');
  assert.equal(fs.readFileSync(file + '.rsp-backup', 'utf8'), old);
  assert.ok(apply(['ruflo-context-contract']).incomplete);
  assert.equal(fs.readFileSync(file, 'utf8'), foreignNative);
  const changedNative = pristine.replace("reason: 'no-memories'", "reason: 'changed-native'");
  fs.writeFileSync(file, changedNative); fs.writeFileSync(file + '.rsp-backup', pristine);
  assert.ok(apply(['ruflo-context-contract']).incomplete);
  assert.equal(fs.readFileSync(file, 'utf8'), changedNative);
  assert.equal(fs.readFileSync(file + '.rsp-backup', 'utf8'), pristine);
  // Unknown edits inside or beside an old overlay cannot be removed as ours.
  for (const foreign of ['\n' + pristine.replace(CONTEXT_351, () => contextWithLease(CONTEXT_NEW)) + '\n// foreign',
    ('\n' + pristine.replace(CONTEXT_351, () => contextWithLease(CONTEXT_NEW))).replace('explicit MemoryPattern data only', 'unknown changed contract')]) {
    fs.writeFileSync(file, foreign); fs.writeFileSync(file + '.rsp-backup', pristine);
    assert.ok(apply(['ruflo-context-contract']).incomplete);
    assert.equal(fs.readFileSync(file, 'utf8'), foreign);
    assert.ok(apply([]).incomplete);
    assert.equal(fs.readFileSync(file, 'utf8'), foreign);
    assert.equal(fs.readFileSync(file + '.rsp-backup', 'utf8'), pristine);
  }
  let synthesize = (memories) => ({ totalMemories: memories.length,
    successRate: memories.filter(x => x.success).length / memories.length,
    averageReward: memories.reduce((sum, x) => sum + x.reward, 0) / memories.length });
  if (argv[1]) {
    const req = createRequire(fs.realpathSync(argv[1]));
    const pure = await import(pathToFileURL(req.resolve('agentdb/controllers/ContextSynthesizer')));
    synthesize = pure.ContextSynthesizer.synthesize.bind(pure.ContextSynthesizer);
  }
  const mod = await import('data:text/javascript;base64,' + Buffer.from(pristine).toString('base64'));
  const episodes = [{ task: 'one', reward: .8, success: true, critique: 'Preserve actual outcome fields.' },
    { task: 'two', reward: .2, success: false, critique: 'Preserve actual outcome fields.' }];
  const query = 'complete economics composition adoption FUR P1 fair comparison';
  for (const real of [false, true]) for (const [label, rows, ok] of [
    ['mixed', episodes, true], ['zero', [{ task: 'zero', reward: 0, success: false }], true],
    ['empty', [], false], ['facts', [{ value: query }], false], ['malformed', [{ value: '{bad' }], false],
    ['inherited', [Object.create(episodes[0])], false], ['wrong-type', [{ ...episodes[0], success: 'true' }], false],
    ['partial', [episodes[0], { value: 'research document' }], true],
  ]) {
    let calls = 0, args;
    const hm = { async recall(...input) { args = input; return rows; } };
    if (real) hm.promote = () => assert.fail('never writes');
    mod.setRegistry({ get: name => name === 'hierarchicalMemory' ? hm : { synthesize(input) { calls++; return synthesize(input); } } });
    const result = await mod.bridgeContextSynthesize({ query, maxEntries: 5 });
    assert.equal(result.success, ok, label);
    assert.deepEqual(args, real ? [{ query, k: 5 }] : [query, 5]);
    if (!ok) assert.equal(calls, 0);
    if (label === 'mixed') { assert.equal(result.synthesis.successRate, .5); assert.equal(result.synthesis.averageReward, .5); }
    if (label === 'zero') assert.equal(result.synthesis.averageReward, 0);
    if (label === 'empty') assert.deepEqual(result, { success: false, reason: 'no-memories', error: 'No memories matched the query', recalled: 0, eligible: 0, skipped: 0 });
    if (label === 'facts') assert.equal(result.reason, 'no-eligible-episodes');
  }
  for (const [hm, cs, reason] of [
    [{ async recall() { throw Error('recall failed'); } }, { synthesize }, 'recall-failed'],
    [{ recall: () => ({}) }, { synthesize }, 'invalid-recall-result'],
    [{ recall: () => episodes }, { synthesize() { throw Error('synthesis failed'); } }, 'synthesizer-failed'],
    [{ recall: () => episodes }, null, 'synthesizer-unavailable'],
  ]) {
    mod.setRegistry({ get: name => name === 'hierarchicalMemory' ? hm : cs });
    const result = await mod.bridgeContextSynthesize({ query });
    assert.equal(result.success, false); assert.equal(result.reason, reason);
  }
  console.log('PASS native context: 20 behavior cases, exact released restoration, current-only retirement, historical uninstall and unknown-source refusal (no DB)');
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
