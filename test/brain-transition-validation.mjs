import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-transition-validation-test-')));
process.env.RUFLO_SOURCE_PATCH_HOME = temporary;
process.env.RSP_RUVNET_BRAIN_HOME = path.join(temporary, '.cache/ruvnet-brain');
process.env.RSP_CODEX_HOME = path.join(temporary, '.codex');
const patch = await import('../lib/brain-transition-validation/patcher.mjs');
const { exerciseTransitionSource, probeTransitionValidationReplacement } = await import('../lib/brain-transition-validation/probe.mjs');
const source = fs.readFileSync(new URL('./fixtures/brain-transition-validation/project-transition-hook.mjs', import.meta.url), 'utf8');
const contract = fs.readFileSync(new URL('./fixtures/brain-managed-cli-capture/scripts/project-progression-contract.mjs', import.meta.url), 'utf8');
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
try {
  const result = patch.patchSource(source);
  assert.deepEqual(result.missing, []);
  assert.equal(patch.isPatched(result.next), true);
  assert.equal(patch.reverseSource(result.next), source);
  assert.deepEqual(patch.patchSource(result.next), { next: result.next, applied: [], missing: [] });
  for (const invalid of [source + source, source.replace(patch.EDITS[0][0], '// changed native builder'), result.next + result.next]) {
    assert.equal(patch.patchSource(invalid).next, invalid);
    assert.ok(patch.patchSource(invalid).missing.length);
  }
  const before = exerciseTransitionSource(source, contract, { expectedRestores: 2 });
  const after = exerciseTransitionSource(result.next, contract);
  const withoutCounts = value => JSON.parse(JSON.stringify(value, (key, v) => key === 'restoreCalls' ? undefined : v));
  assert.deepEqual(withoutCounts(after), withoutCounts(before), 'real native contract outputs and failures must remain identical');
  assert.throws(() => exerciseTransitionSource(source, contract), /exactly once/, 'unmodified native double validation reproduces');
  assert.throws(() => exerciseTransitionSource(result.next.replace('const restored = restoreProjectProgression(snapshots, { expectedProjectIdentity: resolution.projectIdentity });',
    'const restored = {ok:true,heads:[],state:null};'), contract), undefined, 'public validation cannot disappear');
  assert.throws(() => exerciseTransitionSource(result.next.replace('if (snapshots.length && !restored.ok)', 'if (false)'), contract), undefined,
    'normalized ancestry check cannot disappear');
  const notice = await import('../lib/brain-transition-notice/patcher.mjs');
  assert.equal(notice.patchSource(result.next).next, patch.patchSource(notice.patchSource(source).next).next, 'disjoint notice patch composes in either order');
  const activeRoot = path.join(process.env.RSP_RUVNET_BRAIN_HOME, 'versions/4.5.4');
  const { VENDOR_SPECS } = await import('../lib/brain-managed-memory-boundary/transforms.mjs');
  for (const spec of VENDOR_SPECS) write(path.join(activeRoot, spec.relative), '// native discovery fixture');
  write(path.join(activeRoot, 'scripts/hook-input.mjs'), '// discovery fixture');
  write(path.join(activeRoot, '.claude-plugin/plugin.json'), '{"name":"ruvnet-brain","version":"4.5.4"}');
  const file = path.join(activeRoot, 'scripts/project-transition-hook.mjs');
  write(file, source); write(path.join(activeRoot, 'scripts/project-progression-contract.mjs'), contract);
  const active = path.join(process.env.RSP_RUVNET_BRAIN_HOME, 'active.json');
  const identity = '{"version":"4.5.4","codeRoot":"versions/4.5.4"}'; write(active, identity);
  assert.deepEqual(patch.discover(), [file]);
  assert.equal(patch.preflight().ok, true);
  assert.equal(probeTransitionValidationReplacement({ files: [file] }).state, 'live');
  const compose = await import('../lib/plugin-compose.mjs');
  const applied = compose.applyComposed([patch.NAME]);
  assert.equal(applied.errors, 0, JSON.stringify(applied));
  assert.equal(applied.incomplete, 0, JSON.stringify(applied));
  assert.equal(applied.patched, 1);
  assert.equal(compose.applyComposed([patch.NAME]).patched, 0);
  assert.equal(probeTransitionValidationReplacement({ files: [file], installed: [patch.NAME] }).state, 'live', 'local patch cannot retire itself');
  assert.equal(compose.reconcile([], [patch.NAME]).errors, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), source, 'selective removal returns exact pristine');
  write(file, result.next.replaceAll(patch.PATCH_MARKER, 'native future implementation'));
  assert.equal(probeTransitionValidationReplacement({ files: [file] }).state, 'superseded', 'native behavioral replacement retires');
  write(file, source.replace(patch.EDITS[0][0], '// unsupported upstream change'));
  assert.equal(patch.preflight().ok, false);
  assert(compose.applyComposed([patch.NAME]).incomplete > 0);
  assert.equal(fs.readFileSync(active, 'utf8'), identity, 'native active selection remains untouched');
  // Exact tagged v4.5.7 source: native satisfaction is independent of version identity.
  const native457 = fs.readFileSync(new URL('./fixtures/brain-transition-validation/native-4.5.7.mjs', import.meta.url), 'utf8');
  assert(patch.nativeSatisfied(native457));
  assert.deepEqual(patch.patchSource(native457), { next: native457, applied: [], missing: [] });
  exerciseTransitionSource(native457, contract);
  write(file, native457);
  assert.equal(patch.preflight().ok, true);
  assert.equal(probeTransitionValidationReplacement({ files: [file] }).state, 'superseded');
  const nativeApply = compose.applyComposed([patch.NAME]);
  assert.equal(nativeApply.incomplete, 0, JSON.stringify(nativeApply));
  assert.equal(nativeApply.patched, 0, 'native source is not rewritten');
  const broken457 = native457.replaceAll('if (snapshots.length && !restored.ok)', 'if (false)');
  assert.equal(patch.nativeSatisfied(broken457), false);
  assert.throws(() => exerciseTransitionSource(broken457, contract));
  assert.equal(patch.nativeSatisfied(native457 + native457), false);
  console.log('brain-transition-validation: native equivalence, one restore, public validation, ancestry/digest/foreign/collision/dedup/receipt guards, exact composition and retirement passed');
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
