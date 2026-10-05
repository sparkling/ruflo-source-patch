import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exerciseSuspensionSources, probeProgressionSuspensionReplacement,
  prepareNativeProgressionSuspensionRetirement, prepareNativeProgressionSuspensionApplication,
  verifyNativeProgressionSuspensionPreserved, CONTROL } from '../lib/brain-progression-suspension/probe.mjs';
import { NAME, SPECS, descriptor, preflight, patchSource, nativeSatisfied } from '../lib/brain-progression-suspension/patcher.mjs';
import { applyComposed, statusComposed } from '../lib/plugin-compose.mjs';
const fixture = new URL('./fixtures/brain-progression-suspension/native/', import.meta.url);
const sources = {};
for (const directory of ['scripts', 'mcp']) for (const file of fs.readdirSync(new URL(directory, fixture))) {
  sources[directory + '/' + file] = fs.readFileSync(new URL(directory + '/' + file, fixture), 'utf8');
}
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-suspension-native-test-'));
try {
  const exercise = path.join(temporary, 'exercise'); fs.mkdirSync(exercise);
  const proof = await exerciseSuspensionSources(sources, exercise);
  assert.equal(proof.forgedFlagRejected, true);
  const root = path.join(temporary, 'plugin');
  fs.cpSync(fixture, root, { recursive: true });
  const surfaces = [{ root, kind: 'full' }], installed = [NAME];
  const env = { ...process.env, HOME: path.join(temporary, 'home'), RUVNET_BRAIN_STATE_DIR: path.join(temporary, 'state') };
  const options = { surfaces, installed, env };
  const policy = path.join(env.RUVNET_BRAIN_STATE_DIR, 'brain-progression-suspension');
  assert.equal(probeProgressionSuspensionReplacement(options).state, 'superseded');
  assert.equal(fs.existsSync(policy), false, 'pure retirement proof cannot set live operator control');
  assert.equal(preflight({ selected: surfaces, env }).ok, false, 'native no-op is not satisfaction until persisted control exists');
  assert.equal(fs.existsSync(policy), false, 'preflight is read-only');
  for (const [relative, source] of Object.entries(sources).filter(([relative]) => relative !== CONTROL && !relative.includes('checkpoint'))) {
    assert(nativeSatisfied(source), relative); assert.deepEqual(patchSource(source), { next: source, applied: [], missing: [] });
  }
  const before = Object.fromEntries(Object.keys(sources).map(relative => [relative, fs.readFileSync(path.join(root, relative), 'utf8')]));
  const prepared = prepareNativeProgressionSuspensionRetirement(options);
  assert.deepEqual(prepared.errors, []);
  assert.equal(prepared.receipt.before.automaticProgression, 'enabled');
  assert.equal(prepared.receipt.after.source, 'operator-state');
  assert.equal(fs.statSync(policy).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(fs.readFileSync(policy)), { schemaVersion: 1, suspended: true });
  const stat = fs.statSync(policy);
  assert.deepEqual(prepareNativeProgressionSuspensionRetirement(options).errors, []);
  assert.equal(fs.statSync(policy).mtimeMs, stat.mtimeMs, 'already transferred suspension is never rewritten');
  assert.equal(verifyNativeProgressionSuspensionPreserved(options).ok, true);
  assert.equal(preflight({ selected: surfaces, env }).ok, true);
  assert.deepEqual(Object.fromEntries(Object.keys(sources).map(relative => [relative, fs.readFileSync(path.join(root, relative), 'utf8')])), before);
  fs.writeFileSync(policy, '{bad policy');
  assert(prepareNativeProgressionSuspensionRetirement(options).errors.length);
  assert.equal(fs.readFileSync(policy, 'utf8'), '{bad policy', 'corrupt native state is preserved');
  assert.equal(verifyNativeProgressionSuspensionPreserved(options).ok, false);
  fs.rmSync(policy);
  assert(prepareNativeProgressionSuspensionRetirement({ ...options, installed: [] }).errors.length);
  assert.equal(fs.existsSync(policy), false, 'no prior selected containment grants no suspension transfer');
  const old = path.join(temporary, 'older'); fs.mkdirSync(old);
  const mixed = { ...options, surfaces: [...surfaces, { root: old, kind: 'full' }] };
  assert.equal(probeProgressionSuspensionReplacement(mixed).state, 'live', 'mixed native/old copies cannot retire the old overlay');
  assert.deepEqual(prepareNativeProgressionSuspensionApplication(mixed).errors, [], 'native subset can inherit operator suspension before mixed apply');
  assert.equal(verifyNativeProgressionSuspensionPreserved(options).ok, true);
  fs.rmSync(policy);
  const control = path.join(root, CONTROL);
  fs.renameSync(control, control + '.unavailable');
  assert.equal(probeProgressionSuspensionReplacement(options).state, 'live', 'older 4.5.5 without official control keeps overlay');
  assert(prepareNativeProgressionSuspensionRetirement(options).errors.length);
  assert.equal(fs.existsSync(policy), false);
  assert.deepEqual(prepareNativeProgressionSuspensionApplication(options).errors, [], 'legacy copies retain overlay without creating native policy');
  assert.equal(fs.existsSync(policy), false);
  fs.renameSync(control + '.unavailable', control);
  for (const relative of Object.keys(sources)) {
    const file = path.join(root, relative);
    fs.writeFileSync(file, sources[relative] + '\n/* unknown boundary */\n');
    assert.equal(probeProgressionSuspensionReplacement(options).state, 'live', relative);
    fs.writeFileSync(file, sources[relative]);
  }
  fs.renameSync(control, control + '.real'); fs.symlinkSync(control + '.real', control);
  assert.equal(probeProgressionSuspensionReplacement(options).state, 'live', 'symlink source refuses migration');
  fs.unlinkSync(control); fs.renameSync(control + '.real', control);
  const shell = path.join(temporary, 'shell'); fs.mkdirSync(path.join(shell, 'mcp'), { recursive: true });
  fs.writeFileSync(path.join(shell, 'mcp', 'managed-cli-interface.mjs'), sources['mcp/managed-cli-interface.mjs']);
  assert.equal(probeProgressionSuspensionReplacement({ ...options, surfaces: [...surfaces, { root: shell, kind: 'mcp' }] }).state, 'live');
  fs.mkdirSync(path.join(shell, 'scripts')); fs.writeFileSync(path.join(shell, CONTROL), sources[CONTROL]);
  assert.equal(probeProgressionSuspensionReplacement({ ...options, surfaces: [...surfaces, { root: shell, kind: 'mcp' }] }).state, 'superseded');
  // Exercise the shared mutating boundary. Status must never authorize policy
  // writes; application must complete the official handoff before any no-op.
  fs.rmSync(policy, { force: true });
  const originalDescriptor = { ...descriptor };
  try {
    descriptor.discover = () => SPECS.map(spec => path.join(root, spec.relative));
    descriptor.prepare = () => prepareNativeProgressionSuspensionApplication(options);
    descriptor.preflight = () => preflight({ selected: surfaces, env });
    descriptor.isPatched = source => nativeSatisfied(source) && verifyNativeProgressionSuspensionPreserved(options).ok;
    assert.equal(statusComposed([NAME])[NAME].patched, 0);
    assert.equal(fs.existsSync(policy), false, 'status never calls the mutating prepare hook');
    const applied = applyComposed([NAME], { cliTargets: [] });
    assert.equal(applied.incomplete, 0, JSON.stringify(applied));
    assert.equal(verifyNativeProgressionSuspensionPreserved(options).ok, true);
    assert.equal(statusComposed([NAME])[NAME].patched, SPECS.length);
    fs.rmSync(policy);
    fs.appendFileSync(control, '\n/* unknown boundary */\n');
    const refused = applyComposed([NAME], { cliTargets: [] });
    assert(refused.incomplete > 0);
    assert.equal(fs.existsSync(policy), false, 'unproved native source cannot mutate operator policy');
    fs.writeFileSync(control, sources[CONTROL]);
  } finally { Object.assign(descriptor, originalDescriptor); }
  console.log('PASS native progression suspension: behavior, official persisted handoff, idempotence, refusal, old runtime preservation and source integrity');
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
