import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-champion-authority-test-')));
process.env.RUFLO_SOURCE_PATCH_HOME = temporary;
process.env.RUFLO_GLOBAL_ROOT = path.join(temporary, 'global');
process.env.RUFLO_NPX_ROOT = path.join(temporary, 'npx');
process.env.RSP_CODEX_HOME = path.join(temporary, '.codex');
const patch = await import('../lib/ruflo-champion-authority/patcher.mjs');
const { exerciseChampionAuthority } = await import('../lib/ruflo-champion-authority/exercise.mjs');
const { probeChampionAuthorityReplacement } = await import('../lib/ruflo-champion-authority/probe.mjs');
const compose = await import('../lib/plugin-compose.mjs');
const { ENTRIES, composeCliContribution } = await import('../lib/cwd/patch-library.mjs');
const { readState, writeState } = await import('../lib/cwd/state.mjs');
const write = (file, value) => {
  assert.ok(file.startsWith(temporary + path.sep));
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value);
};
try {
  assert.equal(patch.applicability().state, 'not-applicable');
  const source = fs.readFileSync(new URL('./fixtures/ruflo-champion-authority/harness-feedback-applier.js', import.meta.url), 'utf8');
  await assert.rejects(exerciseChampionAuthority(source), /framework auto-apply must refuse/);
  const result = patch.patchSource(source);
  assert.deepEqual(result.missing, []); assert.equal(patch.isPatched(result.next), true);
  assert.equal(patch.reverseSource(result.next), source);
  const explicit = 'export function applyChampionParams';
  assert.equal(result.next.slice(result.next.indexOf(explicit)), source.slice(source.indexOf(explicit)), 'explicit promoter bytes unchanged');
  assert.deepEqual(patch.patchSource(result.next), { next: result.next, missing: [], applied: [] });
  await exerciseChampionAuthority(result.next);
  await assert.rejects(exerciseChampionAuthority(result.next.replace('state.activeChampionRef !== null', 'false')), /framework auto-apply must refuse/);
  for (const invalid of [source + source, result.next + result.next,
    source.replace('if (!adopted?.championId)', 'if (!adopted)'),
    result.next.replace('return __rspWithChampionAuthority(cfDir', 'return changed(cfDir')]) {
    assert.ok(patch.patchSource(invalid).missing.length); assert.equal(patch.patchSource(invalid).next, invalid);
  }
  const file = path.join(process.env.RUFLO_GLOBAL_ROOT, '@claude-flow/cli/dist/src/config/harness-feedback-applier.js');
  write(file, source);
  assert.equal(patch.preflight().ok, true); assert.equal(patch.applicability().state, 'applicable');
  assert.equal(probeChampionAuthorityReplacement().state, 'live');
  let installed = compose.applyComposed([patch.NAME]);
  assert.equal(installed.errors, 0, JSON.stringify(installed)); assert.equal(installed.incomplete, 0);
  assert.equal(installed.patched, 1); assert.equal(compose.applyComposed([patch.NAME]).patched, 0);
  assert.equal(probeChampionAuthorityReplacement({ installed: [patch.NAME] }).state, 'live', 'local patch cannot retire itself');
  write(file, result.next + '// unrelated live change');
  assert.ok(compose.applyComposed([patch.NAME]).incomplete > 0);
  assert.equal(fs.readFileSync(file, 'utf8'), result.next + '// unrelated live change', 'foreign live bytes preserved');
  write(file, result.next);
  assert.equal(compose.reconcile([], [patch.NAME]).errors, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), source, 'uninstall restores pristine');

  // Shared physical file: either installation order and either removal must retain its sibling.
  const cwdEntry = ENTRIES.filter(entry => entry.id === 'state/harness-applier');
  assert.equal(cwdEntry.length, 1);
  const cwdOnly = composeCliContribution(source, cwdEntry, { file });
  assert.deepEqual(cwdOnly.missing, []);
  const both = patch.patchSource(cwdOnly.next).next;
  assert.equal(composeCliContribution(result.next, cwdEntry, { file }).next, both, 'installation order invariant');
  assert.equal(patch.reverseSource(both), cwdOnly.next);
  await exerciseChampionAuthority(both); // Calls from nested cwd and observes the root lock.
  writeState({ ...readState(), patchTargets: ['cwd'], pluginTargets: [patch.NAME] });
  installed = compose.applyComposed([patch.NAME]);
  assert.equal(installed.errors, 0); assert.equal(installed.incomplete, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), both);
  assert.equal(probeChampionAuthorityReplacement().state, 'live', 'composed local patch cannot self-retire');
  assert.equal(compose.reconcile([], [patch.NAME]).errors, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), cwdOnly.next, 'removing guard preserves cwd');
  assert.equal(compose.applyComposed([patch.NAME]).errors, 0);
  writeState({ ...readState(), patchTargets: [], pluginTargets: [patch.NAME] });
  installed = compose.applySharedCliFiles([], new Set([file]));
  assert.equal(installed.errors, 0); assert.equal(installed.incomplete, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), result.next, 'removing cwd preserves guard');
  assert.equal(compose.reconcile([], [patch.NAME]).errors, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), source);
  write(file, result.next.replaceAll(patch.PATCH_MARKER, 'native equivalent authority serialization'));
  assert.equal(probeChampionAuthorityReplacement().state, 'superseded', 'retirement requires native behavior');
  write(file, source.replace('if (!adopted?.championId)', 'if (!adopted)'));
  assert.equal(patch.preflight().ok, false); assert.ok(compose.applyComposed([patch.NAME]).incomplete > 0);
  console.log('ruflo-champion-authority: native repro, authority and lock preservation, framework adoption, cwd composition, uninstall and behavioral retirement passed');
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
