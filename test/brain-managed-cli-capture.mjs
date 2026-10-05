import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-managed-capture-test-')));
process.env.RUFLO_SOURCE_PATCH_HOME = path.join(temporary, 'home');
const patcher = await import('../lib/brain-managed-cli-capture/patcher.mjs');
const { probeCaptureBehavior } = await import('../lib/brain-managed-cli-capture/probe.mjs');
const fixture = fileURLToPath(new URL('./fixtures/brain-managed-cli-capture/', import.meta.url));
const write = (file, source) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, source); };
const transform = (source) => { const result = patcher.patchSource(source); return result.missing.length ? source : result.next; };
try {
  const native457 = fileURLToPath(new URL('./fixtures/brain-managed-cli-native-457/', import.meta.url));
  assert.equal(probeCaptureBehavior(native457).state, 'proven', 'tagged native 4.5.7 passes exact action/no-op/redaction/receipt behavior');
  for (const spec of patcher.SPECS) {
    const native = fs.readFileSync(path.join(native457, spec.relative), 'utf8');
    assert(patcher.nativeSatisfied(native));
    assert.deepEqual(patcher.patchSource(native), { next: native, applied: [], missing: [] });
    assert(!patcher.hasPatch(native), 'native satisfaction is not local ownership');
    assert(!patcher.nativeSatisfied(native.replace('function toolAction(', 'function alteredAction(').replace('export function buildProjectProgression(', 'export function alteredProducer(')));
  }
  assert.equal(probeCaptureBehavior(fixture).state, 'live', 'actual native 4.5.4 code reproduces refusal before a new managed action');
  assert.equal(probeCaptureBehavior(fixture, { transform }).state, 'proven', 'native producer/writer replay proves actions, retention, redaction and receipt refusal');
  const patchedRoot = path.join(temporary, 'staged-native');
  for (const name of ['project-progression-producer.mjs', 'project-progression-hook.mjs', 'project-progression-contract.mjs']) {
    const source = fs.readFileSync(path.join(fixture, 'scripts', name), 'utf8');
    const result = patcher.patchSource(source);
    if (name !== 'project-progression-contract.mjs') {
      assert.deepEqual(result.missing, []);
      assert.equal(patcher.isPatched(result.next), true);
      assert.equal(patcher.reverseSource(result.next), source);
      assert.deepEqual(patcher.patchSource(result.next), { next: result.next, applied: [], missing: [] });
      for (const invalid of [source + source, source.replace(patcher.SPECS.find(spec => spec.relative.endsWith(name)).edits[0][1], '/* upstream drift */'), result.next + result.next]) {
        assert.equal(patcher.isPatched(invalid), false);
        assert.equal(patcher.patchSource(invalid).next, invalid);
        assert.equal(patcher.patchSource(invalid).missing.length, 1);
      }
    }
    write(path.join(patchedRoot, 'scripts', name), transform(source));
  }
  assert.equal(probeCaptureBehavior(patchedRoot).state, 'proven');
  const producer = path.join(patchedRoot, 'scripts/project-progression-producer.mjs');
  const producerBytes = fs.readFileSync(producer, 'utf8');
  const unredacted = producerBytes.replace('redactProgression(enrichStateWithObservation(projectProgression.completeProjectState, payload)).value', 'enrichStateWithObservation(projectProgression.completeProjectState, payload)');
  write(producer, unredacted);
  assert.equal(patcher.isPatched(unredacted), false);
  assert.equal(probeCaptureBehavior(patchedRoot).state, 'unknown', 'redaction mutation cannot pass native behavior proof');
  write(producer, producerBytes);
  const hook = path.join(patchedRoot, 'scripts/project-progression-hook.mjs');
  const hookBytes = fs.readFileSync(hook, 'utf8');
  write(hook, hookBytes.replace('commands: [...commands, observation],', 'commands: [...commands, observation, observation],'));
  assert.equal(probeCaptureBehavior(patchedRoot).state, 'unknown', 'double enrichment is detected');
  write(hook, hookBytes.replace("declaredOutcome || (terminal ? 'success' : 'unknown')", "declaredOutcome || 'success'"));
  assert.equal(probeCaptureBehavior(patchedRoot).state, 'unknown', 'unproved success is detected');
  write(hook, hookBytes);
  // Real discovery owner, native active selection and shared composition. Only
  // synthetic source fixtures are created here; no Brain updater is run.
  const home = process.env.RUFLO_SOURCE_PATCH_HOME;
  const brain = path.join(home, '.cache/ruvnet-brain');
  const activeRoot = path.join(brain, 'versions/4.5.4');
  const { VENDOR_SPECS } = await import('../lib/brain-managed-memory-boundary/transforms.mjs');
  for (const spec of VENDOR_SPECS) write(path.join(activeRoot, spec.relative), 'fixture native discovery member');
  write(path.join(activeRoot, 'scripts/hook-input.mjs'), 'export const parseHookEvent=()=>null;');
  write(path.join(activeRoot, '.claude-plugin/plugin.json'), '{"name":"ruvnet-brain","version":"4.5.4"}');
  for (const name of ['project-progression-producer.mjs', 'project-progression-hook.mjs', 'project-progression-contract.mjs']) {
    write(path.join(activeRoot, 'scripts', name), fs.readFileSync(path.join(fixture, 'scripts', name), 'utf8'));
  }
  const active = path.join(brain, 'active.json');
  const activeBytes = '{"version":"4.5.4","codeRoot":"versions/4.5.4"}'; write(active, activeBytes);
  const retained = path.join(brain, 'versions/4.5.3');
  fs.cpSync(activeRoot, retained, { recursive: true });
  write(path.join(retained, '.claude-plugin/plugin.json'), '{"name":"ruvnet-brain","version":"4.5.3"}');
  const retainedHook = path.join(retained, 'scripts/project-progression-hook.mjs');
  const retainedNative = fs.readFileSync(retainedHook, 'utf8');
  assert(!patcher.discover().includes(retainedHook), 'unowned old generation excluded');
  write(retainedHook, transform(retainedNative));
  assert(patcher.discover().includes(retainedHook), 'retained owned generation remains a composition claimant');
  write(retainedHook, retainedNative);
  assert.equal(patcher.preflight().ok, true);
  const compose = await import('../lib/plugin-compose.mjs');
  assert(compose.COMPOSE_TARGETS.includes(patcher.NAME), 'new bundle must use the shared composition owner');
  const applied = compose.applyComposed([patcher.NAME]);
  assert.equal(applied.errors, 0, applied.log.join('\n')); assert.equal(applied.incomplete, 0);
  assert.equal(applied.patched, 2);
  assert.equal(probeCaptureBehavior(activeRoot).state, 'proven');
  const { brainManagedCliCaptureSupersession } = await import('../lib/brain-managed-cli-capture/supersede.mjs');
  assert.equal(brainManagedCliCaptureSupersession().check().state, 'live', 'local projection cannot prove native retirement');
  const restored = compose.reconcile([], [patcher.NAME]); assert.equal(restored.errors, 0);
  for (const spec of patcher.SPECS) {
    assert.equal(fs.readFileSync(path.join(activeRoot, spec.relative), 'utf8'), fs.readFileSync(path.join(fixture, spec.relative), 'utf8'));
  }
  // An incomplete pair blocks every member before the shared engine writes.
  const member = path.join(activeRoot, patcher.SPECS[0].relative);
  const original = fs.readFileSync(member, 'utf8');
  write(member, original.replace(patcher.SPECS[0].edits[0][1], '/* native anchor changed */'));
  const blocked = compose.applyComposed([patcher.NAME]); assert(blocked.incomplete > 0);
  assert.equal(fs.readFileSync(path.join(activeRoot, patcher.SPECS[1].relative), 'utf8'), fs.readFileSync(path.join(fixture, patcher.SPECS[1].relative), 'utf8'));
  for (const spec of patcher.SPECS) {
    const fixed = transform(fs.readFileSync(path.join(fixture, spec.relative), 'utf8'));
    // Remove only this target's ownership comments to model a native equivalent.
    write(path.join(activeRoot, spec.relative), fixed.split('\n').filter(line => !line.includes(patcher.PATCH_MARKER)).join('\n'));
  }
  assert.equal(brainManagedCliCaptureSupersession().check().state, 'superseded');
  assert.equal(fs.readFileSync(active, 'utf8'), activeBytes, 'native active selector remains untouched');
  console.log('✓ Brain #382: native no-op refusal reproduced, new action redaction/single enrichment/real outcomes/exact receipt guards, bundle safety, pristine restore and native retirement');
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
