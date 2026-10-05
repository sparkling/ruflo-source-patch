import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-managed-generation-test-')));
process.env.RUFLO_SOURCE_PATCH_HOME = path.join(temporary, 'home');
const patcher = await import('../lib/brain-managed-cli-generation/patcher.mjs');
const { exerciseGenerationServer, probeManagedCliGenerationReplacement } = await import('../lib/brain-managed-cli-generation/probe.mjs');
const source = fs.readFileSync(fileURLToPath(new URL('./fixtures/brain-managed-cli-generation/server.mjs', import.meta.url)), 'utf8');
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
try {
  await assert.rejects(exerciseGenerationServer(source, path.join(temporary, 'unpatched')), /isError|Assertion|undefined/, 'native copied interface cannot capture without its manifest');
  const result = patcher.patchSource(source);
  assert.deepEqual(result.missing, []); assert.equal(patcher.isPatched(result.next), true);
  assert.equal(patcher.reverseSource(result.next), source, 'exact pristine round trip');
  assert.deepEqual(patcher.patchSource(result.next), { next: result.next, applied: [], missing: [] });
  await exerciseGenerationServer(result.next, path.join(temporary, 'patched'));
  for (const bad of [source + source, source.replace(patcher.EDITS[0][1], '/* drift */'), result.next + result.next,
    result.next.replace('manifest?.name !== \'ruvnet-brain\'', 'false'),
    result.next.replace('!managedHelp.has(native.helpKey(args?.executable, args?.argv ?? []))', 'false')]) {
    assert.equal(patcher.isPatched(bad), false); assert(patcher.patchSource(bad).missing.length); assert.equal(patcher.patchSource(bad).next, bad);
  }
  for (const [label, altered] of [
    ['manifest', result.next.replace("manifest?.name !== 'ruvnet-brain'", 'false')],
    ['help', result.next.replace('!managedHelp.has(native.helpKey(args?.executable, args?.argv ?? []))', 'false')],
    ['promotion', result.next.replace('managedHelp = new Set(); }', '/* retained old help */ }')],
  ]) await assert.rejects(exerciseGenerationServer(altered, path.join(temporary, label)), undefined, 'unsafe native-equivalent behavior must fail executable retirement proof');
  const home = process.env.RUFLO_SOURCE_PATCH_HOME, brain = path.join(home, '.cache/ruvnet-brain');
  const activeRoot = path.join(brain, 'versions/4.5.4');
  const { VENDOR_SPECS, fixtureSources } = await import('../lib/brain-managed-memory-boundary/transforms.mjs');
  const boundaryFixture = fixtureSources();
  for (const spec of VENDOR_SPECS) write(path.join(activeRoot, spec.relative), spec.id === 'hijack' ? boundaryFixture.hijack : boundaryFixture.shim);
  write(path.join(activeRoot, 'scripts/hook-input.mjs'), 'export const parseHookEvent=()=>null;');
  write(path.join(activeRoot, '.claude-plugin/plugin.json'), '{"name":"ruvnet-brain","version":"4.5.4"}');
  write(path.join(activeRoot, 'mcp/server.mjs'), source);
  const shell = path.join(home, '.claude/ruvnet-brain');
  write(path.join(shell, 'mcp/server.mjs'), source); write(path.join(shell, 'mcp/managed-cli-interface.mjs'), 'fixture native interface');
  const selector = path.join(brain, 'active.json'), selected = '{"version":"4.5.4","codeRoot":"versions/4.5.4"}'; write(selector, selected);
  assert.equal(patcher.discover().length, 2, 'both native selected generation and persistent MCP shell are owned');
  assert.equal(patcher.preflight().ok, true);
  assert.equal(probeManagedCliGenerationReplacement().state, 'live', 'manifest omission reproduces in marker-free upstream shell');
  const compose = await import('../lib/plugin-compose.mjs');
  assert(compose.COMPOSE_TARGETS.includes(patcher.NAME));
  const applied = compose.applyComposed([patcher.NAME]); assert.equal(applied.errors, 0, applied.log.join('\n')); assert.equal(applied.incomplete, 0); assert.equal(applied.patched, 2);
  assert.equal(probeManagedCliGenerationReplacement({ installed: [patcher.NAME] }).state, 'live', 'local patch is not native replacement');
  const reverted = compose.reconcile([], [patcher.NAME]); assert.equal(reverted.errors, 0);
  for (const file of patcher.discover()) assert.equal(fs.readFileSync(file, 'utf8'), source);
  // Preserve the existing managed-memory diagnostic owner when the new target retires.
  const boundary = await import('../lib/brain-managed-memory-boundary/patcher.mjs');
  const state = await import('../lib/cwd/state.mjs');
  state.writeState({ ...state.readState(), pluginTargets: ['brain-managed-memory-boundary'] });
  const blockedFresh = compose.applyComposed(['brain-managed-memory-boundary', patcher.NAME]);
  assert(blockedFresh.incomplete > 0, 'shared composer cannot bypass first full atomic boundary installation');
  for (const file of patcher.discover()) { assert.equal(fs.readFileSync(file, 'utf8'), source); assert(!fs.existsSync(file + '.rsp-backup')); }
  const firstBoundary = boundary.apply(); assert.equal(firstBoundary.incomplete, 0, firstBoundary.log.join('\n')); assert.equal(firstBoundary.errors, 0);
  const installed = ['brain-managed-memory-boundary', patcher.NAME];
  state.writeState({ ...state.readState(), pluginTargets: installed });
  const combined = compose.applyComposed(installed); assert.equal(combined.errors, 0, combined.log.join('\n')); assert.equal(combined.incomplete, 0);
  assert.equal(boundary.apply().errors, 0); assert.equal(boundary.apply().incomplete, 0, 'independent transaction recognizes exact composed server');
  let boundaryStatus = boundary.status(); assert.equal(boundaryStatus.patched, boundaryStatus.files, boundaryStatus.log.join('\n'));
  const unchanged = new Map(patcher.discover().map(file => [file, fs.readFileSync(file, 'utf8')]));
  const editedServer = patcher.discover()[0], originalServer = fs.readFileSync(editedServer, 'utf8');
  write(editedServer, originalServer + '\n// external accepted change with retained markers\n');
  assert(compose.applyComposed(installed).incomplete > 0, 'retained markers never authorize overwriting external edits');
  assert(boundary.apply().incomplete > 0); assert(boundary.restore().incomplete > 0);
  assert.equal(fs.readFileSync(editedServer, 'utf8'), originalServer + '\n// external accepted change with retained markers\n');
  assert.equal(fs.readFileSync(editedServer + '.rsp-backup', 'utf8'), source);
  write(editedServer, originalServer);
  for (const member of ['scripts/managed-memory-policy.mjs', 'scripts/hijack-ruvnet.sh']) {
    const file = path.join(activeRoot, member), original = fs.readFileSync(file, 'utf8');
    write(file, 'foreign incomplete member');
    assert(compose.applyComposed(installed).incomplete > 0, 'invalid full boundary member blocks shared server writes');
    assert(boundary.apply().incomplete > 0, 'full transaction also refuses without partial writes');
    for (const [server, bytes] of unchanged) { assert.equal(fs.readFileSync(server, 'utf8'), bytes); assert.equal(fs.readFileSync(server + '.rsp-backup', 'utf8'), source); }
    write(file, original);
  }
  // Native promotion is fixture-controlled; previously patched generations
  // remain exact shared owners without selecting or patching unowned history.
  const nextRoot = path.join(brain, 'versions/4.5.5');
  for (const spec of VENDOR_SPECS) write(path.join(nextRoot, spec.relative), spec.id === 'hijack' ? boundaryFixture.hijack : boundaryFixture.shim);
  write(path.join(nextRoot, 'scripts/hook-input.mjs'), 'export const parseHookEvent=()=>null;');
  write(path.join(nextRoot, '.claude-plugin/plugin.json'), '{"name":"ruvnet-brain","version":"4.5.5"}');
  write(path.join(nextRoot, 'mcp/server.mjs'), source);
  write(selector, '{"version":"4.5.5","codeRoot":"versions/4.5.5"}');
  assert(patcher.discover().includes(path.join(activeRoot, 'mcp/server.mjs')), 'old generation retains its own existing contribution');
  const promoted = boundary.apply(); assert.equal(promoted.incomplete, 0, promoted.log.join('\n')); assert.equal(promoted.errors, 0);
  assert.equal(compose.applyComposed(installed).incomplete, 0);
  boundaryStatus = boundary.status(); assert.equal(boundaryStatus.patched, boundaryStatus.files, boundaryStatus.log.join('\n'));
  write(selector, selected); // return this synthetic test's selected owner
  const removed = compose.reconcile(['brain-managed-memory-boundary'], [patcher.NAME]); assert.equal(removed.errors, 0, removed.log.join('\n'));
  state.writeState({ ...state.readState(), pluginTargets: ['brain-managed-memory-boundary'] });
  for (const file of patcher.discover()) {
    const live = fs.readFileSync(file, 'utf8'); assert(!patcher.hasPatch(live));
    assert(live.includes('stuinfla/ruvnet-brain#102/#103')); assert.equal(compose.composeSource(source, ['brain-managed-memory-boundary'], { file }), live);
  }
  const lastBoundary = boundary.restore(); assert.equal(lastBoundary.errors, 0); assert.equal(lastBoundary.incomplete, 0, lastBoundary.log.join('\n'));
  state.writeState({ ...state.readState(), pluginTargets: [] });
  for (const file of patcher.discover()) assert.equal(fs.readFileSync(file, 'utf8'), source);
  // A generation-first installation must not absorb its bytes into the boundary
  // backup or lose them when the complete boundary transaction comes later.
  state.writeState({ ...state.readState(), pluginTargets: [patcher.NAME] });
  assert.equal(compose.applyComposed([patcher.NAME]).incomplete, 0);
  const generationOnlyFile = patcher.discover()[0], generationOnlyBytes = fs.readFileSync(generationOnlyFile, 'utf8');
  write(generationOnlyFile, generationOnlyBytes + '\n// external generation-only change\n');
  assert(compose.applyComposed([patcher.NAME]).incomplete > 0, 'generation-only mode also requires exact shared pristine provenance');
  assert.equal(fs.readFileSync(generationOnlyFile, 'utf8'), generationOnlyBytes + '\n// external generation-only change\n');
  assert.equal(fs.readFileSync(generationOnlyFile + '.rsp-backup', 'utf8'), source);
  write(generationOnlyFile, generationOnlyBytes);
  state.writeState({ ...state.readState(), pluginTargets: installed });
  const generationFirst = boundary.apply(); assert.equal(generationFirst.incomplete, 0, generationFirst.log.join('\n')); assert.equal(generationFirst.errors, 0);
  for (const file of patcher.discover()) { assert(patcher.isPatched(fs.readFileSync(file, 'utf8'))); assert.equal(fs.readFileSync(file + '.rsp-backup', 'utf8'), source); }
  assert.equal(boundary.restore().incomplete, 0);
  state.writeState({ ...state.readState(), pluginTargets: [patcher.NAME] });
  assert.equal(compose.reconcile([], [patcher.NAME]).errors, 0);
  state.writeState({ ...state.readState(), pluginTargets: [] });
  // Reverse uninstall order preserves generation and its true pristine while
  // removing boundary-owned additives only through the full transaction.
  state.writeState({ ...state.readState(), pluginTargets: ['brain-managed-memory-boundary'] });
  assert.equal(boundary.apply().incomplete, 0);
  state.writeState({ ...state.readState(), pluginTargets: installed });
  assert.equal(compose.applyComposed(installed).incomplete, 0);
  const withoutBoundary = boundary.restore(); assert.equal(withoutBoundary.incomplete, 0, withoutBoundary.log.join('\n')); assert.equal(withoutBoundary.errors, 0);
  for (const file of patcher.discover()) {
    assert.equal(fs.readFileSync(file, 'utf8'), result.next);
    assert.equal(fs.readFileSync(file + '.rsp-backup', 'utf8'), source);
    assert(!fs.existsSync(path.join(path.dirname(path.dirname(file)), 'mcp/managed-memory-diagnostic.mjs')));
  }
  state.writeState({ ...state.readState(), pluginTargets: [patcher.NAME] });
  assert.equal(compose.reconcile([], [patcher.NAME]).errors, 0);
  state.writeState({ ...state.readState(), pluginTargets: [] });
  for (const file of patcher.discover()) assert.equal(fs.readFileSync(file, 'utf8'), source);
  // Marker-free native equivalent can retire only after full behavior succeeds.
  const nativeEquivalent = result.next.split('\n').filter(line => !line.includes(patcher.PATCH_MARKER)).join('\n');
  fs.rmSync(nextRoot, { recursive: true, force: true });
  for (const file of patcher.discover()) write(file, nativeEquivalent);
  const native = probeManagedCliGenerationReplacement({ installed: [] }); assert.equal(native.state, 'superseded', native.evidence);
  assert.equal(fs.readFileSync(selector, 'utf8'), selected, 'native update selector is untouched');
  const nativeRoot = new URL('./fixtures/brain-managed-cli-generation/native-4.5.7/', import.meta.url);
  const native457 = Object.fromEntries([['server', 'server'], ['dispatcher', 'managed-cli-generation'], ['managed', 'managed-cli-interface']]
    .map(([key, name]) => [key, fs.readFileSync(new URL(name + '.mjs', nativeRoot), 'utf8')]));
  const { exerciseNativeGeneration } = await import('../lib/brain-managed-cli-generation/native-probe.mjs');
  assert(patcher.nativeSatisfied(native457.server));
  assert.deepEqual(patcher.patchSource(native457.server), { next: native457.server, applied: [], missing: [] });
  await exerciseNativeGeneration(native457, path.join(temporary, 'native457'));
  for (const [label, changed] of [
    ['stamp-binding', { ...native457, managed: native457.managed.replace('receipt.generation !== binding', 'false') }],
    ['identity', { ...native457, dispatcher: native457.dispatcher.replace("manifest.name !== 'ruvnet-brain'", 'false') }],
    ['immutable', { ...native457, dispatcher: native457.dispatcher.replace('pinned && pinned !== selected.sourceDigest', 'false') }],
  ]) await assert.rejects(exerciseNativeGeneration(changed, path.join(temporary, 'native457-' + label)), undefined, label);
  for (const file of patcher.discover()) {
    write(file, native457.server);
    write(path.join(path.dirname(file), 'managed-cli-generation.mjs'), native457.dispatcher);
    write(path.join(path.dirname(file), 'managed-cli-interface.mjs'), native457.managed);
  }
  assert.equal(patcher.preflight().ok, true);
  const nativeProof = probeManagedCliGenerationReplacement({ installed: [] });
  assert.equal(nativeProof.state, 'superseded', nativeProof.evidence);
  const nativeApply = compose.applyComposed([patcher.NAME]);
  assert.equal(nativeApply.incomplete, 0, JSON.stringify(nativeApply)); assert.equal(nativeApply.patched, 0);
  const dispatcher = path.join(path.dirname(patcher.discover()[0]), 'managed-cli-generation.mjs');
  write(dispatcher, native457.dispatcher.replace("manifest.name !== 'ruvnet-brain'", 'false'));
  assert.equal(patcher.preflight().ok, false, 'a native-looking shell does not prove its helper is safe');
  write(dispatcher, native457.dispatcher);
  console.log('✓ Brain #384: missing persistent manifest reproduced; selected owner, literal arguments, successful help, concurrent promotion, path/manifest refusal, exact restoration, composition and executable retirement');
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
