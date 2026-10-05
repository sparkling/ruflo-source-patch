import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-outbox-streaming-test-'))), home = path.join(temporary, 'home');
process.env.HOME = home; process.env.RUFLO_SOURCE_PATCH_HOME = home;
process.env.RSP_CODEX_HOME = path.join(home, '.codex'); process.env.RUFLO_NPX_ROOT = path.join(home, '.npm/_npx'); process.env.RUFLO_GLOBAL_ROOT = path.join(home, 'global');
process.env.RSP_RUVNET_BRAIN_HOME = path.join(home, '.cache/ruvnet-brain');
process.env.RSP_RUVNET_BRAIN_MARKETPLACE = path.join(home, '.claude/plugins/marketplaces/ruvnet-brain'); process.env.RSP_RUVNET_BRAIN_RUNTIME = path.join(home, '.claude/ruvnet-brain');
const patcher = await import('../lib/brain-outbox-streaming/patcher.mjs');
const { probeOutboxStreamingBehavior, exerciseOutbox, exerciseReplayContainment } = await import('../lib/brain-outbox-streaming/probe.mjs');
const { brainOutboxStreamingSupersession } = await import('../lib/brain-outbox-streaming/supersede.mjs');
const fixture = fileURLToPath(new URL('./fixtures/brain-outbox-streaming/project-progression-outbox.mjs', import.meta.url));
const source = fs.readFileSync(fixture, 'utf8'), patched = patcher.patchSource(source);
const write = (file, bytes) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); };
try {
  assert.deepEqual(patched.missing, []); assert(patcher.isPatched(patched.next)); assert.equal(patcher.reverseSource(patched.next), source);
  assert.deepEqual(patcher.patchSource(patched.next), { next: patched.next, applied: [], missing: [] });
  for (const invalid of [source + source, source.replace(patcher.EDITS[0][1], '/* upstream drift */'), patched.next + patched.next]) {
    assert(!patcher.isPatched(invalid)); assert.equal(patcher.patchSource(invalid).next, invalid); assert.equal(patcher.patchSource(invalid).missing.length, 1);
  }
  assert.equal(probeOutboxStreamingBehavior(fixture).state, 'live', 'native whole-file reads violate bounded-read proof');
  assert.equal(probeOutboxStreamingBehavior(fixture, { transform: value => patcher.patchSource(value).next }).state, 'proven');
  const small = await exerciseOutbox(patched.next, path.join(temporary, 'small')); assert(small.nativeFsync);
  // Native differential proof for ordered blank/error/final-line semantics.
  const baselineFile = path.join(temporary, 'baseline.mjs'), candidateFile = path.join(temporary, 'candidate.mjs'); write(baselineFile, source); write(candidateFile, patched.next);
  const Baseline = (await import(pathToFileURL(baselineFile).href)).ProgressionOutbox;
  const Candidate = (await import(pathToFileURL(candidateFile).href)).ProgressionOutbox;
  const baseline = new Baseline({ projectRoot: path.join(temporary, 'baseline-project') }), candidate = new Candidate({ projectRoot: path.join(temporary, 'candidate-project') });
  const fragments = ['', '{}', 'null', 'true', '0', '["雪😀"]', '{"x":"é"}', 'broken', ' ', '\r'];
  const result = outbox => { try { return { records: outbox.records() }; } catch (error) { return { error: error.message }; } };
  for (let index = 0; index < 200; index++) {
    const lines = [fragments[index % 10], fragments[Math.floor(index / 10) % 10], fragments[(index * 7) % 10]];
    const text = lines.join(index % 3 ? '\n' : '\r\n') + (index % 2 ? '\n' : '');
    write(baseline.path, text); write(candidate.path, text); assert.deepEqual(result(candidate), result(baseline));
  }
  write(candidate.path, '{}\n{"next":true}\n');
  const nativeRead = fs.readSync;
  let reads = 0;
  fs.readSync = function(fd, buffer, offset, length, position) { reads++; return reads > 1 ? 0 : nativeRead.call(this, fd, buffer, offset, Math.min(length, 3), position); };
  try { assert.throws(() => candidate.records(), /outbox journal changed while reading/, 'premature EOF cannot acknowledge an incomplete journal'); }
  finally { fs.readSync = nativeRead; }
  fs.readSync = function(fd, buffer, offset, length, position) { return nativeRead.call(this, fd, buffer, offset, Math.min(length, 3), position); };
  try { assert.deepEqual(candidate.records(), [{}, { next: true }], 'partial positive reads retain complete evidence'); }
  finally { fs.readSync = nativeRead; }
  const before = fs.readFileSync(candidate.path);
  write(candidate.path, '{"complete":true}'); const finalBefore = fs.readFileSync(candidate.path);
  fs.readSync = function(fd, buffer, offset, length, position) { return length > 1 ? 0 : nativeRead.call(this, fd, buffer, offset, length, position); };
  try { assert.throws(() => candidate.appendRecord({ next: true }), /incomplete outbox final record/); }
  finally { fs.readSync = nativeRead; }
  assert.deepEqual(fs.readFileSync(candidate.path), finalBefore, 'short tail inspection never writes over evidence'); assert(before.length > 0);
  // Regression-only real file beyond V8's total-string limit. Reuse 1-MiB
  // newline buffers; never allocate a giant Buffer/string or invoke native full read.
  const huge = await exerciseOutbox(patched.next, path.join(temporary, 'huge'), { large: true });
  assert(huge.hugeJournalBytes > huge.maximumStringLength); console.log('  huge synthetic native outbox proof:', JSON.stringify(huge));
  const brain = path.join(home, '.cache/ruvnet-brain'), activeRoot = path.join(brain, 'versions/4.5.4');
  const { VENDOR_SPECS } = await import('../lib/brain-managed-memory-boundary/transforms.mjs');
  for (const spec of VENDOR_SPECS) write(path.join(activeRoot, spec.relative), 'fixture native discovery member');
  write(path.join(activeRoot, 'scripts/hook-input.mjs'), 'export const parseHookEvent=()=>null;');
  write(path.join(activeRoot, '.claude-plugin/plugin.json'), '{"name":"ruvnet-brain","version":"4.5.4"}');
  const member = path.join(activeRoot, patcher.RELATIVE); write(member, source);
  const active = path.join(brain, 'active.json'), activeBytes = '{"version":"4.5.4","codeRoot":"versions/4.5.4"}'; write(active, activeBytes);
  assert(patcher.discover().every(file => file.startsWith(temporary + path.sep)), 'all mutations confined to isolated fixture');
  const compose = await import('../lib/plugin-compose.mjs'); assert(compose.COMPOSE_TARGETS.includes(patcher.NAME));
  const installed = compose.applyComposed([patcher.NAME]); assert.equal(installed.errors, 0, installed.log.join('\n')); assert.equal(installed.incomplete, 0); assert.equal(installed.patched, 1);
  assert.equal(fs.readFileSync(member + '.rsp-backup', 'utf8'), source); assert.equal(probeOutboxStreamingBehavior(member).state, 'proven');
  assert.equal(brainOutboxStreamingSupersession().check().state, 'live');
  const drift = fs.readFileSync(member, 'utf8') + '\n// unrelated external update'; write(member, drift);
  const refused = compose.applyComposed([patcher.NAME]); assert(refused.incomplete > 0); assert.equal(fs.readFileSync(member, 'utf8'), drift); assert.equal(fs.readFileSync(member + '.rsp-backup', 'utf8'), source);
  write(member, patched.next); const restored = compose.reconcile([], [patcher.NAME]); assert.equal(restored.errors, 0, restored.log.join('\n')); assert.equal(fs.readFileSync(member, 'utf8'), source);
  write(member, patched.next.split('\n').filter(line => !line.includes(patcher.PATCH_MARKER)).join('\n'));
  assert.equal(brainOutboxStreamingSupersession().check().state, 'superseded', 'marker-free executable native replacement required');
  assert.equal(fs.readFileSync(active, 'utf8'), activeBytes, 'native updater selection unchanged');
  const native457 = fs.readFileSync(new URL('./fixtures/brain-outbox-streaming/native-4.5.7.mjs', import.meta.url), 'utf8');
  assert(patcher.nativeSatisfied(native457));
  assert.deepEqual(patcher.patchSource(native457), { next: native457, applied: [], missing: [] });
  await exerciseOutbox(native457, path.join(temporary, 'native457'));
  write(member, native457);
  assert.equal(patcher.preflight().ok, true);
  assert.equal(brainOutboxStreamingSupersession().check().state, 'superseded');
  const nativeApply = compose.applyComposed([patcher.NAME]);
  assert.equal(nativeApply.incomplete, 0, JSON.stringify(nativeApply));
  assert.equal(nativeApply.patched, 0, 'native outbox is not rewritten');
  const broken457 = native457.replace('line += 1;', 'line += 2;');
  assert.equal(patcher.nativeSatisfied(broken457), false);
  await assert.rejects(exerciseOutbox(broken457, path.join(temporary, 'native457-broken')));
  const native456 = fs.readFileSync(new URL('./fixtures/brain-outbox-streaming/native-4.5.6.mjs', import.meta.url), 'utf8');
  assert.deepEqual(patcher.nativeCapabilities(native456), { streaming: true, lazyReplay: false });
  assert.deepEqual(patcher.nativeCapabilities(native457), { streaming: true, lazyReplay: true });
  assert.deepEqual(patcher.patchSource(native456), { next: native456, applied: [], missing: [] });
  await exerciseOutbox(native456, path.join(temporary, 'native456'));
  write(member, native456);
  assert.equal(patcher.preflight().ok, true);
  assert.equal(brainOutboxStreamingSupersession().check().state, 'superseded', '#387 does not claim #390 historical containment');
  const native456Apply = compose.applyComposed([patcher.NAME]);
  assert.equal(native456Apply.incomplete, 0, JSON.stringify(native456Apply)); assert.equal(native456Apply.patched, 0);
  for (const altered of [native456 + '\n// unexplained change', native456.replace('line += 1;', 'line += 2;')]) {
    assert.equal(patcher.nativeCapabilities(altered), null);
    assert.equal(patcher.nativeSatisfied(altered), false);
    assert(patcher.patchSource(altered).missing.length, 'unknown native source must refuse');
  }
  await assert.rejects(exerciseOutbox(native456.replace('line += 1;', 'line += 2;'), path.join(temporary, 'native456-broken')));
  const containment = await exerciseReplayContainment(native457, path.join(temporary, 'native457-containment'));
  assert(containment.historicalBytes > 128 * 1024 * 1024);
  console.log('  separate #390 partial containment proof (4.5.7 only):', JSON.stringify(containment));
  console.log('✓ Brain #387: native JSONL semantics, UTF-8 seams, exact append/fsync/torn suffixes/quarantine, >V8-string journal, shared pristine restoration and executable retirement');
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
