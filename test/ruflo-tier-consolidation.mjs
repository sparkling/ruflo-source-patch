import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-tier-withdrawal-'));
process.env.RUFLO_SOURCE_PATCH_HOME = path.join(scratch, 'home');
process.env.RUFLO_NPX_ROOT = path.join(scratch, 'npx');
process.env.RUFLO_GLOBAL_ROOT = path.join(scratch, 'global');
for (const name of ['RSP_NO_SELF_UPDATE', 'RSP_NO_MONITOR_RECOVER', 'RSP_NO_LAUNCHCTL', 'RSP_NO_STALE_WRITER_KILL', 'RSP_NO_HOST_AUTO_UPDATE']) process.env[name] = '1';
const tier = await import('../lib/ruflo-tier-consolidation/patcher.mjs');
const selected = await import('../lib/ruflo-selective-learning/patcher.mjs');
const context = await import('../lib/ruflo-context-contract/patcher.mjs');
const { apply, inspect } = await import('../lib/cwd/patch-library.mjs');
const { applyComposed, reconcile } = await import('../lib/plugin-compose.mjs');
const { applyInstalled } = await import('../lib/cwd/commands.mjs');
const { addTargets, addPluginTargets, removeTargets, removePluginTargets, readState } = await import('../lib/cwd/state.mjs');
const guidance = await import('../lib/ruflo-context-guidance/patcher.mjs');
const cli = path.join(scratch, 'global/@claude-flow/cli');
const memory = path.join(cli, 'node_modules/@claude-flow/memory');
const write = (file, content) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
write(path.join(cli, 'package.json'), '{"name":"@claude-flow/cli","version":"3.71.1","type":"module"}');
write(path.join(memory, 'package.json'), '{"name":"@claude-flow/memory","version":"3.2.2","type":"module","exports":"./dist/index.js"}');
write(path.join(memory, 'dist/index.js'), 'export {};');
const learningFile = path.join(cli, 'dist/src/mcp-tools/hooks-tools.js');
const nativeLearning = JSON.parse(fs.readFileSync(new URL('./fixtures/ruflo-native-learning.json', import.meta.url), 'utf8')).tool;
const tool = JSON.parse(fs.readFileSync(new URL('./fixtures/ruflo-context-guidance.json', import.meta.url), 'utf8')).tool;
const sources = new Map(tier.SPECS.map(spec => {
  const file = spec.file === 'tiered-memory.js' || spec.file === 'controller-registry.js'
    ? path.join(memory, 'dist', spec.file) : path.join(cli, 'dist/src', spec.file === 'memory-bridge.js' ? 'memory' : 'mcp-tools', spec.file);
  let content = spec.file === 'tiered-memory.js'
    ? fs.readFileSync(new URL('./fixtures/tiered-memory/native-3.0.0.mjs', import.meta.url), 'utf8')
    : spec.edits.map(([from]) => from).join('\n');
  if (spec.file === 'memory-bridge.js') content += '\n' + context.CONTEXT_NATIVE_HELPERS + context.CONTEXT_351 + '\n// ===== Phase 3: ReasoningBank pattern operations =====';
  if (spec.file === 'agentdb-tools.js') content += '\n' + tool;
  return [file, content + '\n'];
}));
const retained = path.join(scratch, 'retained-history-fixture.json');
const retainedBytes = JSON.stringify({ rows: [{ id: 'source', tier: 'episodic', value: '{"task":"old","success":false,"reward":0}' },
  { id: 'tm_consolidated_fixture', tier: 'semantic', key: 'consolidated:old', value: '{"task":"old","success":false,"reward":0}' }],
patterns: [{ id: 42, taskType: 'selected-trajectory:old', approach: 'complete historical trajectory' }] });
write(retained, retainedBytes);
const released = former => {
  addTargets(['ruflo-context-contract']); addPluginTargets(['ruflo-tier-consolidation', 'ruflo-context-guidance', 'ruflo-selective-learning']);
  write(learningFile + '.rsp-backup', nativeLearning);
  write(learningFile, selected.legacyPatchSource(nativeLearning).next);
  for (const [file, original] of sources) {
    let current = original.includes(context.CONTEXT_351) ? '\n' + original.replace(context.CONTEXT_351, () => context.contextWithLease(former)) : original;
    current = tier.legacyPatchSource(current).next;
    if (file.endsWith('/memory-bridge.js')) current = selected.legacyPatchSource(current).next;
    if (file.endsWith('/agentdb-tools.js')) current = guidance.patchSource(current).next;
    write(file + '.rsp-backup', original); write(file, current);
  }
};
const restored = () => {
  assert.equal(fs.readFileSync(learningFile, 'utf8'), selected.patchSource(nativeLearning).next, 'bridge withdrawal updates its former selected caller together');
  for (const [file, original] of sources) {
    assert.equal(fs.readFileSync(file, 'utf8'), file.endsWith('/agentdb-tools.js') ? guidance.patchSource(original).next : original, file);
    assert.ok(tier.nativeSatisfied(fs.readFileSync(file, 'utf8')));
  }
  assert.equal(fs.readFileSync(retained, 'utf8'), retainedBytes, 'all historical fixture data remains byte-identical');
};
try {
  for (const [file, source] of sources) {
    const old = tier.legacyPatchSource(source).next;
    assert.notEqual(old, source); assert.equal(tier.patchSource(old).next, source);
    assert.equal(tier.patchSource(source).next, source);
    assert.equal(tier.reverse(old), source);
    const unknown = old.replace(tier.MARKER, tier.MARKER + ' unknown');
    assert.ok(tier.patchSource(unknown).missing.length); assert.equal(tier.patchSource(unknown).next, unknown);
  }
  for (const former of [context.CONTEXT_PREVIOUS, context.CONTEXT_RELEASED, context.CONTEXT_NEW]) {
    released(former);
    assert.ok(tier.preflight().ok, JSON.stringify(tier.preflight()));
    const result = apply(['ruflo-context-contract']);
    assert.equal(result.incomplete, 0, JSON.stringify(result)); assert.equal(result.errors, 0, JSON.stringify(result));
    restored();
  }
  released(context.CONTEXT_NEW);
  const uninstalledTier = reconcile(['ruflo-context-guidance', 'ruflo-selective-learning'], ['ruflo-tier-consolidation']);
  assert.equal(uninstalledTier.errors, 0, JSON.stringify(uninstalledTier));
  assert.equal(uninstalledTier.incomplete, 0, JSON.stringify(uninstalledTier)); restored();
  released(context.CONTEXT_NEW); removeTargets(['ruflo-context-contract']);
  const uninstalledContext = apply([]);
  assert.equal(uninstalledContext.errors, 0, JSON.stringify(uninstalledContext)); restored();
  // Bundle-wide foreign edits must block both normal application and removal.
  released(context.CONTEXT_NEW);
  const registry = [...sources.keys()].find(file => file.endsWith('/controller-registry.js'));
  fs.appendFileSync(registry, '\n// foreign change outside owned anchors\n');
  const before = new Map([...sources.keys(), learningFile].map(file => [file, fs.readFileSync(file, 'utf8')]));
  assert.equal(tier.preflight().ok, false);
  assert.ok(apply(['ruflo-context-contract']).incomplete);
  for (const [file, bytes] of before) assert.equal(fs.readFileSync(file, 'utf8'), bytes);
  assert.ok(reconcile(['ruflo-context-guidance', 'ruflo-selective-learning'], ['ruflo-tier-consolidation']).incomplete);
  for (const [file, bytes] of before) assert.equal(fs.readFileSync(file, 'utf8'), bytes);
  released(context.CONTEXT_NEW);
  fs.writeFileSync(learningFile, fs.readFileSync(learningFile, 'utf8').replace('distillLearning()', 'unknownLearning()'));
  const beforeUnknownCaller = new Map([...sources.keys(), learningFile].map(file => [file, fs.readFileSync(file, 'utf8')]));
  assert.ok(apply(['ruflo-context-contract']).incomplete);
  for (const [file, bytes] of beforeUnknownCaller) assert.equal(fs.readFileSync(file, 'utf8'), bytes,
    'unknown selected caller protects the complete context/tier bundle');
  assert.ok(reconcile(['ruflo-context-guidance', 'ruflo-selective-learning'], ['ruflo-tier-consolidation']).incomplete);
  for (const [file, bytes] of beforeUnknownCaller) assert.equal(fs.readFileSync(file, 'utf8'), bytes, 'failed caller blocks orphan removal too');
  released(context.CONTEXT_NEW);
  let result = applyInstalled(readState());
  assert.equal(result.errors, 0, JSON.stringify(result)); assert.equal(result.incomplete, 0, JSON.stringify(result)); restored();
  result = applyInstalled(readState());
  assert.equal(result.errors, 0, JSON.stringify(result)); restored();
  assert.ok(readState().retired['ruflo-context-contract']); assert.ok(readState().retired['ruflo-tier-consolidation']);
  // A later all-install may add the target names again. Their contributions stay native.
  addTargets(['ruflo-context-contract']); addPluginTargets(['ruflo-tier-consolidation']);
  result = applyInstalled(readState());
  assert.equal(result.errors, 0, JSON.stringify(result)); restored();
  assert.equal(readState().patchTargets.includes('ruflo-context-contract'), false);
  assert.equal(readState().pluginTargets.includes('ruflo-tier-consolidation'), false);
  assert.equal(inspect()['ruflo-context-contract'].native, 1);
  write(path.join(process.env.RUFLO_SOURCE_PATCH_HOME, '.claude/settings.json'), '{}');
  for (const target of ['ruflo-context-contract', 'ruflo-tier-consolidation']) {
    const child = spawnSync(process.execPath, [path.resolve('bin/cli.mjs'), target, 'install'],
      { env: process.env, encoding: 'utf8', timeout: 30000 });
    assert.equal(child.status, 0, child.stdout + child.stderr);
    assert.match(child.stdout, /retired/i);
    restored();
  }

  // Native unsupported is a real refusal, not successful empty consolidation.
  const bridge = tier.SPECS.find(spec => spec.file === 'memory-bridge.js').edits[0][0];
  const call = new Function('getRegistry', 'operationContext', bridge.replace('export async function', 'async function') + '\nreturn bridgeConsolidate;')(
    async () => ({ get: () => ({ consolidate: () => ({ source: 'stub', promoted: 0, pruned: 0 }) }) }), { getStore: () => ({ active: true }) });
  const unsupported = await call({});
  assert.equal(unsupported.success, false); assert.equal(unsupported.status, 'unsupported');
  console.log('PASS tier withdrawal: all released compositions, coupled core/plugin removal, preserved sibling and data, bundle refusal, native unsupported, all/monitor retirement');
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
