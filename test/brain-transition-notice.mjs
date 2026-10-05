import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sandbox = fs.realpathSync(path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-transition-'))));
process.env.RUFLO_SOURCE_PATCH_HOME = sandbox;
process.env.RSP_RUVNET_BRAIN_HOME = path.join(sandbox, '.cache/ruvnet-brain');
process.env.RSP_CODEX_HOME = path.join(sandbox, '.codex');
const patch = await import('../lib/brain-transition-notice/patcher.mjs');
const { exerciseSources, probeTransitionNoticeReplacement } = await import('../lib/brain-transition-notice/probe.mjs');
const { VENDOR_SPECS } = await import('../lib/brain-managed-memory-boundary/transforms.mjs');
const notice = `const NOTICE_STATE = '.continuity-stop-notices.json';\n${patch.NOTICE_ANCHOR}\n`;
// Recorded 4.5.4 dispatch boundaries; capture bodies remain outside notice ownership.
const degraded = "process.stdout.write(JSON.stringify({ systemMessage: 'Project memory transition capture degraded; exact readback was not verified.' }));";
const capture = 'const untouchedCaptureContract = { queue: "fsync", fence: "native", consent: "native", receipt: "exact" };\n';
const compat = `${capture}// Compatibility entrypoint uses the same minimized transition producer as direct registrations.
void (async () => {
  try {
    const { runProjectTransitionHook } = await import('./project-transition-hook.mjs');
    const payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
    const result = runProjectTransitionHook(payload.cwd || projectDirectory(), process.argv[2], { payload });
${patch.COMPAT_ANCHOR}
  } catch { ${degraded} }
})();`;
const direct = `${patch.IMPORT_ANCHOR}\n${capture}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
    const result = runProjectTransitionHook(payload.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd(), process.argv[2], { payload });
${patch.DIRECT_ANCHOR}
  } catch { ${degraded} }
}`;
const sources = { notice, compat, direct };
const patched = {};
for (const [name, source] of Object.entries(sources)) {
  const result = patch.patchSource(source);
  assert.deepEqual(result.missing, []);
  assert.equal(patch.isPatched(result.next), true);
  assert.equal(patch.reverseSource(result.next), source, 'byte-exact pristine roundtrip');
  assert.deepEqual(patch.patchSource(result.next), { next: result.next, applied: [], missing: [] });
  patched[name] = result.next;
  for (const drift of [source + source, source.replace('stopNotice(', 'stopNotice ('), result.next.replace(patch.PATCH_MARKER, 'foreign owner')]) {
    if (drift === source || drift === result.next) continue;
    const rejected = patch.patchSource(drift);
    assert.equal(rejected.next, drift);
    assert.ok(rejected.missing.length, `${name}: drift must refuse patching`);
  }
  if (name !== 'notice') {
    assert.equal(result.next.includes(capture), true, 'capture/persistence/fencing/consent/receipt contract untouched');
    assert.equal(result.next.includes(degraded), true, 'degraded capture output remains unchanged');
  }
}
await assert.rejects(exerciseSources(sources, path.join(sandbox, 'vendor')), /deduplicated/, 'red: vendor repeats same warning');
await exerciseSources(patched, path.join(sandbox, 'patched'));
for (const [id, mutate] of [
  ['silent-first', s => ({ ...s, compat: s.compat.replace('if (message)', 'if (false)') })],
  ['cross-session', s => ({ ...s, notice: s.notice.replace("String(session || 'unknown')", "'all-sessions'") })],
  ['hide-degraded', s => ({ ...s, direct: s.direct.replace(degraded, '') })],
  ['skip-capture', s => ({ ...s, compat: s.compat.replace('const result = runProjectTransitionHook', 'const result = () => runProjectTransitionHook') })],
]) await assert.rejects(exerciseSources(mutate(patched), path.join(sandbox, id)), undefined, id);

function write(file, source) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, source); }
const brainHome = process.env.RSP_RUVNET_BRAIN_HOME;
const active = path.join(brainHome, 'versions/4.5.4');
const cache = path.join(sandbox, '.codex/plugins/cache/ruvnet-brain/ruvnet-brain/4.5.4');
const old = path.join(brainHome, 'versions/4.5.3');
assert.deepEqual(patch.discover(), []);
for (const root of [active, cache, old]) {
  write(path.join(root, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'ruvnet-brain', version: root === old ? '4.5.3' : '4.5.4' }));
  for (const spec of VENDOR_SPECS) write(path.join(root, spec.relative), '// native discovery fixture');
  write(path.join(root, 'scripts/hook-input.mjs'), '// native discovery fixture');
  for (const [i, spec] of patch.SPECS.entries()) write(path.join(root, spec.relative), Object.values(sources)[i]);
}
write(path.join(brainHome, 'active.json'), JSON.stringify({ version: '4.5.4', codeRoot: active }));
assert.equal(patch.discover().length, 6, 'only native active and matching host copy');
assert.equal(patch.preflight().ok, true);
write(path.join(cache, patch.SPECS[1].relative), 'upstream changed');
assert.equal(patch.preflight().ok, false, 'one broken dependent script refuses complete bundle');
write(path.join(cache, patch.SPECS[1].relative), compat);
const files = patch.discover();
assert.equal(probeTransitionNoticeReplacement({ files }).state, 'live', 'unpatched vendor behavior cannot retire target');
for (const root of [active, cache]) {
  for (const [i, spec] of patch.SPECS.entries()) {
    const file = path.join(root, spec.relative);
    write(`${file}.rsp-backup`, Object.values(sources)[i]);
    write(file, Object.values(patched)[i]);
  }
}
const overlayProof = probeTransitionNoticeReplacement({ files, installed: ['brain-transition-notice'] });
assert.equal(overlayProof.state, 'live', 'our applied patch must never masquerade as native retirement');
assert.match(overlayProof.evidence, /same-session compatibility deferral is deduplicated/, 'proven composition is unwrapped and original native behavior is executed');
const staleBackup = `${files[0]}.rsp-backup`;
const savedBackup = fs.readFileSync(staleBackup, 'utf8');
write(staleBackup, `${savedBackup}\nforeign generation`);
assert.match(probeTransitionNoticeReplacement({ files, installed: ['brain-transition-notice'] }).evidence, /composition/);
write(staleBackup, savedBackup);
assert.match(probeTransitionNoticeReplacement({ files, installed: [] }).evidence, /untracked/);
fs.rmSync(staleBackup);
assert.match(probeTransitionNoticeReplacement({ files, installed: ['brain-transition-notice'] }).evidence, /ENOENT/);
write(staleBackup, savedBackup);
fs.renameSync(staleBackup, `${staleBackup}.real`);
fs.symlinkSync(`${staleBackup}.real`, staleBackup);
assert.match(probeTransitionNoticeReplacement({ files, installed: ['brain-transition-notice'] }).evidence, /unsafe/);
fs.rmSync(staleBackup); fs.renameSync(`${staleBackup}.real`, staleBackup);
// Simulated future native implementation: same behavior, no local ownership marker.
for (const root of [active, cache]) for (const [i, spec] of patch.SPECS.entries()) write(path.join(root, spec.relative), Object.values(patched)[i].replaceAll(patch.PATCH_MARKER, 'native future implementation'));
assert.equal(probeTransitionNoticeReplacement({ files }).state, 'superseded');
write(path.join(cache, patch.SPECS[1].relative), patched.compat.replaceAll(patch.PATCH_MARKER, 'native future implementation').replace('if (message)', 'if (false)'));
assert.equal(probeTransitionNoticeReplacement({ files }).state, 'live', 'native-looking broken behavior cannot retire target');

const compose = await import('../lib/plugin-compose.mjs');
for (const root of [active, cache]) for (const [i, spec] of patch.SPECS.entries()) {
  const file = path.join(root, spec.relative);
  write(file, Object.values(sources)[i]);
  fs.rmSync(`${file}.rsp-backup`, { force: true });
}
write(files[0], 'unknown upstream helper');
const refused = compose.applyComposed(['brain-transition-notice']);
assert.ok(refused.incomplete > 0);
assert.equal(refused.patched, 0, 'all dependent files refuse a partial bundle');
assert.equal(files.some(f => fs.existsSync(`${f}.rsp-backup`)), false);
write(files[0], notice);
const activeIdentity = fs.readFileSync(path.join(brainHome, 'active.json'), 'utf8');
const applied = compose.applyComposed(['brain-transition-notice']);
assert.equal(applied.errors, 0, JSON.stringify(applied));
assert.equal(applied.incomplete, 0);
assert.equal(applied.patched, 6);
assert.equal(compose.applyComposed(['brain-transition-notice']).patched, 0);
assert.equal(fs.readFileSync(path.join(brainHome, 'active.json'), 'utf8'), activeIdentity, 'native generation selection is untouched');
assert.equal(fs.readFileSync(path.join(old, patch.SPECS[0].relative), 'utf8'), notice, 'inactive native generations are untouched');
const restored = compose.reconcile([], ['brain-transition-notice']);
assert.equal(restored.errors, 0, JSON.stringify(restored));
for (const root of [active, cache]) for (const [i, spec] of patch.SPECS.entries()) {
  assert.equal(fs.readFileSync(path.join(root, spec.relative), 'utf8'), Object.values(sources)[i], 'exact composed uninstall restores pristine');
}
console.log('brain-transition-notice: exact transforms, truthful deduplication, capture receipts, degraded/continuity preservation, discovery and executable retirement checks passed');

// Native 4.5.7 boundaries are copied from the upstream tag, without local patch markers.
const native457 = Object.fromEntries(['notice', 'compat', 'direct'].map(name => [name,
  fs.readFileSync(new URL(`./fixtures/brain-transition-notice/${name}-4.5.7.mjs`, import.meta.url), 'utf8')]));
for (const source of Object.values(native457)) {
  assert(patch.nativeSatisfied(source));
  assert.deepEqual(patch.patchSource(source), { next: source, applied: [], missing: [] });
  assert.equal(patch.nativeSatisfied(source + source), false);
}
await exerciseSources(native457, path.join(sandbox, 'native457'));
for (const root of [active, cache]) for (const [i, spec] of patch.SPECS.entries()) write(path.join(root, spec.relative), Object.values(native457)[i]);
assert.equal(patch.preflight().ok, true);
assert.equal(probeTransitionNoticeReplacement({ files }).state, 'superseded');
const nativeApply = compose.applyComposed(['brain-transition-notice']);
assert.equal(nativeApply.incomplete, 0, JSON.stringify(nativeApply));
assert.equal(nativeApply.patched, 0, 'native source stays byte identical');
const nativeBroken = { ...native457, compat: native457.compat.replace('if (message)', 'if (false)') };
assert.equal(patch.nativeSatisfied(nativeBroken.compat), false);
await assert.rejects(exerciseSources(nativeBroken, path.join(sandbox, 'native457-broken')));
