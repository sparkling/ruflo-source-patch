import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import * as patch from '../lib/brain-capture-launch/patcher.mjs';
import * as legacy from '../lib/brain-capture-launch/legacy.mjs';
import { patchSource as diagnose, reverseSource as undiagnose } from '../lib/brain-capture-diagnostics/patcher.mjs';
import { composeSource } from '../lib/plugin-compose.mjs';
const native = fs.readFileSync(new URL('./fixtures/brain-learning-receipts/native-4.7.28.mjs', import.meta.url), 'utf8');
const current = patch.patchSource(native); assert.deepEqual(current.missing, []);
const v519 = legacy.PREVIOUS_EDITS.reduce((s, [, from, to]) => s.replace(from, () => to), native);
const v521 = legacy.patchSource(native).next;
for (const source of [native, v519, v521]) {
  assert.equal(patch.patchSource(source).next, current.next);
  assert.equal(patch.reverseSource(source), native);
  const diagnosed = diagnose(source).next;
  assert.equal(patch.patchSource(diagnosed).next, diagnose(current.next).next);
  assert.equal(undiagnose(patch.reverseSource(patch.patchSource(diagnosed).next)), native);
  assert.equal(composeSource(diagnosed, ['brain-capture-diagnostics', 'brain-capture-launch']), diagnose(current.next).next);
}
assert(patch.isPatched(current.next)); assert.equal(patch.reverseSource(current.next), native);
assert.equal(patch.patchSource(current.next).next, current.next);
assert.equal(diagnose(current.next).next, patch.patchSource(diagnose(native).next).next);
for (const [, from, to] of patch.OWNERSHIP_EDITS) {
  const unknown = v521.replace(from, '// external mutation');
  assert(patch.patchSource(unknown).missing.length);
  const changed = current.next.replace(to, '// external mutation');
  assert(!patch.isPatched(changed)); assert(patch.patchSource(changed).missing.length);
  assert.equal(patch.reverseSource(changed), changed);
}
assert.equal(spawnSync(process.execPath, ['--input-type=module', '--check'], { input: current.next }).status, 0);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-capture-ownership-'));
const keyOf = ({ session = '', tool, action }) => 'workflow-' + crypto.createHash('sha256').update(JSON.stringify([String(session), tool, action])).digest('hex');
const dead = spawnSync(process.execPath, ['-e', ''], { stdio: 'ignore' }).pid;
assert.throws(() => process.kill(dead, 0), error => error.code === 'ESRCH');
let seq = 0;
function harness({ source = current.next, launch, write } = {}) {
  const home = path.join(root, String(seq++)), failures = [], launched = [];
  let enabled = true, writes = 0, distills = 0, last;
  const ctx = vm.createContext({ fs, os, path, Date, process, randomUUID: crypto.randomUUID,
    learningContext: () => ({ enabled }), resolveRuflo: () => '/inert/ruflo', observationKey: keyOf,
    recordLearningObservation: (...args) => { writes++; return write?.(...args); },
    distillObservations: () => { distills++; }, recordHookFailure: row => failures.push(row),
    failureScope: () => ({}), validFailureScope: value => value,
    spawn: (exe, argv, options) => { launched.push(options); last = launch?.(exe, argv, options, ctx)
      ?? Object.assign(new EventEmitter(), { pid: process.pid, unref() {} }); return last; },
  });
  vm.runInContext(source.slice(source.indexOf('// LOAD BOUNDS'), source.indexOf('\nconst isMain ='))
    .replace(/\bexport /g, '').replace('fileURLToPath(import.meta.url)', "'/inert/learn-capture.mjs'"), ctx);
  const names = sub => { const dir = path.join(home, 'learn-capture', sub); return fs.existsSync(dir) ? fs.readdirSync(dir) : []; };
  return { home, ctx, failures, launched, names,
    capture: session => ctx.captureLearning({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'git status' }, session_id: session }, { brainHome: home, detach: true }),
    child: (mode = '--observe', override = {}) => { ctx.process = { ...process, env: { ...launched.at(-1)?.env, ...override } }; ctx.runDetached(mode); },
    deny: () => { enabled = false; }, get writes() { return writes; }, get distills() { return distills; }, get last() { return last; },
  };
}
const gate = h => path.join(h.home, 'learn-capture', 'admission.lock');
const putGate = (h, owner, claims = {}) => { fs.mkdirSync(gate(h), { recursive: true }); fs.writeFileSync(path.join(gate(h), 'owner.json'), JSON.stringify(owner));
  const stat = fs.lstatSync(gate(h), { bigint: true });
  for (const [name, value] of Object.entries(claims)) fs.writeFileSync(path.join(gate(h), name), JSON.stringify({ ...value, gate: [stat.dev, stat.ino].join(':'), gateOwner: JSON.stringify(owner) })); };
const owner = pid => ({ pid, start: null, token: crypto.randomUUID() });
try {
  for (const source of [current.next, diagnose(current.next).next]) {
    const h = harness({ source }); assert(h.capture('success')); assert.equal(h.launched.length, 1);
    assert(h.capture('success')); assert.equal(h.launched.length, 1, 'fresh key coalesces');
    h.child(); assert.equal(h.writes, 1); assert.equal(h.names('slots').length, 0);
    assert.deepEqual(h.names('recent'), [keyOf({ session: 'success', tool: 'Bash', action: 'git status' })]);
    assert.equal(h.failures.length, 0);
  }
  const expired = harness(); assert(expired.capture('old-live'));
  for (const sub of ['slots', 'recent']) for (const name of expired.names(sub)) {
    const file = path.join(expired.home, 'learn-capture', sub, name); fs.utimesSync(file, new Date(0), new Date(0));
    if (sub === 'slots') { const row = JSON.parse(fs.readFileSync(file)); row.at = 0; fs.writeFileSync(file, JSON.stringify(row)); }
  }
  assert(expired.capture('old-live')); assert.equal(expired.launched.length, 1, 'live token retains coalescing beyond age');
  assert(expired.capture('distinct')); assert.equal(expired.capture('third'), false); assert.equal(expired.launched.length, 2);
  assert.equal(expired.failures.at(-1).error, 'shed observation (load)');
  expired.ctx.markCaptured(expired.home, keyOf({ session: 'other', tool: 'Bash', action: 'git status' }));
  assert(expired.names('recent').some(n => n.endsWith('.pending')));

  const stale = harness(); const pendingKey = keyOf({ session: 'expired', tool: 'Bash', action: 'git status' });
  const pending = path.join(stale.home, 'learn-capture/recent', pendingKey + '.pending'); fs.mkdirSync(path.dirname(pending), { recursive: true });
  fs.writeFileSync(pending, ''); fs.utimesSync(pending, new Date(0), new Date(0));
  assert(stale.capture('expired')); assert(stale.capture('expired')); assert.equal(stale.launched.length, 1);
  const newToken = fs.readFileSync(pending, 'utf8'); assert.equal(newToken.length, 36);
  stale.ctx.clearInFlight(stale.home, pendingKey, crypto.randomUUID()); assert.equal(fs.readFileSync(pending, 'utf8'), newToken);

  const failed = harness({ launch() { throw Object.assign(Error('private error'), { code: 'EAGAIN' }); } });
  assert.equal(failed.capture('fail'), false); assert.equal(failed.names('slots').length, 0); assert.equal(failed.names('recent').length, 0);
  assert.equal(failed.failures[0].error, 'detach failed: EAGAIN');
  const asyncFail = harness(); assert(asyncFail.capture('async')); asyncFail.last.emit('error', Object.assign(Error(), { code: 'ENOENT' }));
  assert.equal(asyncFail.names('slots').length, 0); assert.equal(asyncFail.names('recent').length, 0);
  const postSpawn = harness(); assert(postSpawn.capture('started')); postSpawn.last.emit('spawn'); postSpawn.last.emit('error', Object.assign(Error(), { code: 'EPIPE' }));
  assert.equal(postSpawn.names('slots').length, 1); assert.equal(postSpawn.names('recent').length, 1);

  const denied = harness(); assert(denied.capture('revoked')); denied.deny(); denied.child();
  assert.equal(denied.writes, 0); assert.equal(denied.names('slots').length, 0); assert.equal(denied.names('recent').length, 0);
  const writeFail = harness({ write() { throw Error('inert native refusal'); } }); assert(writeFail.capture('native-failure')); writeFail.child();
  assert.equal(writeFail.names('recent').length, 0); assert.equal(writeFail.names('slots').length, 0); assert.equal(writeFail.failures[0].error, 'inert native refusal');

  const completed = harness({ launch(_e, _a, options, ctx) { ctx.process = { ...process, env: options.env }; ctx.runDetached('--observe'); } });
  assert(completed.capture('complete-before-parent')); assert.equal(completed.writes, 1); assert.equal(completed.names('slots').length, 0, 'late parent handoff never recreates slot');
  const lost = harness(); assert(lost.capture('lost')); const slot = path.join(lost.home, 'learn-capture/slots', lost.names('slots')[0]);
  const foreign = { pid: process.pid, at: Date.now(), token: crypto.randomUUID() }; fs.writeFileSync(slot, JSON.stringify(foreign));
  lost.child(); assert.equal(lost.writes, 0); assert.equal(JSON.parse(fs.readFileSync(slot)).token, foreign.token);
  assert.equal(lost.failures[0].error, 'capture admission ownership lost');
  const outside = path.join(root, 'foreign-slot'); fs.writeFileSync(outside, JSON.stringify(foreign));
  lost.child('--observe', { RUVNET_LEARN_SLOT: outside }); assert.equal(JSON.parse(fs.readFileSync(outside)).token, foreign.token);
  const distill = harness(); assert(distill.capture('pending')); const before = distill.names('recent'); distill.child('--distill');
  assert.equal(distill.distills, 1); assert.equal(distill.writes, 0); assert.deepEqual(distill.names('recent'), before); assert.equal(distill.names('slots').length, 1);

  const released = harness(); assert(released.capture('delayed')); const opts = released.launched[0].env;
  released.child(); assert(released.capture('replacement')); const replacement = fs.readFileSync(opts.RUVNET_LEARN_SLOT);
  assert.equal(released.ctx.releaseObserveSlot(opts.RUVNET_LEARN_SLOT, process.pid, opts.RUVNET_LEARN_TOKEN, released.home), false);
  assert.deepEqual(fs.readFileSync(opts.RUVNET_LEARN_SLOT), replacement);
  assert.equal(released.ctx.captureHandoff(released.home, opts.RUVNET_LEARN_SLOT, opts.RUVNET_LEARN_TOKEN, process.pid), false);

  // A same-inode replacement can have indistinguishable timestamp identity on Linux.
  // Freeze lstat observations to model that boundary; current ownership must depend on the token.
  const collision = harness(); assert(collision.capture('coarse-identity'));
  const collisionEnv = collision.launched[0].env;
  const collisionKey = keyOf({ session: 'coarse-identity', tool: 'Bash', action: 'git status' });
  const collisionPending = path.join(collision.home, 'learn-capture/recent', collisionKey + '.pending');
  const identities = new Map([collisionEnv.RUVNET_LEARN_SLOT, collisionPending].map(file =>
    [file, { normal: fs.lstatSync(file), bigint: fs.lstatSync(file, { bigint: true }) }]));
  const replacementToken = crypto.randomUUID();
  const collisionRecord = { ...JSON.parse(fs.readFileSync(collisionEnv.RUVNET_LEARN_SLOT)), token: replacementToken };
  fs.writeFileSync(collisionEnv.RUVNET_LEARN_SLOT, JSON.stringify(collisionRecord));
  fs.writeFileSync(collisionPending, replacementToken);
  for (const [file, stats] of identities) assert.equal(fs.lstatSync(file).ino, stats.normal.ino, 'fixture replaced bytes in the same inode');
  collision.ctx.fs = { ...fs, lstatSync(file, options) { const seen = identities.get(file);
    return seen ? (options?.bigint ? seen.bigint : seen.normal) : fs.lstatSync(file, options); } };
  collision.last.emit('error', Object.assign(Error('late failed spawn'), { code: 'EAGAIN' }));
  assert.deepEqual(JSON.parse(fs.readFileSync(collisionEnv.RUVNET_LEARN_SLOT)), collisionRecord);
  assert.equal(fs.readFileSync(collisionPending, 'utf8'), replacementToken);
  assert.equal(collision.failures[0].error, 'detach failed: EAGAIN');

  const recover = harness(); putGate(recover, owner(dead), { 'claim-0.json': owner(dead) }); assert(recover.capture('recovered')); assert(!fs.existsSync(gate(recover)));
  const pausedClaim = harness(); putGate(pausedClaim, owner(dead), { 'claim-0.json': owner(process.pid) });
  let begin = performance.now(); assert.equal(pausedClaim.capture('contended'), false); assert(performance.now() - begin < 500);
  assert.equal(pausedClaim.failures[0].error, 'capture admission contended'); assert(fs.existsSync(gate(pausedClaim)));
  for (const variant of ['malformed', 'foreign', 'symlink', 'empty']) {
    const h = harness(); putGate(h, owner(dead));
    if (variant === 'malformed') fs.writeFileSync(path.join(gate(h), 'owner.json'), '{}');
    if (variant === 'foreign') fs.writeFileSync(path.join(gate(h), 'foreign'), 'preserve');
    if (variant === 'symlink') { fs.unlinkSync(path.join(gate(h), 'owner.json')); fs.symlinkSync(outside, path.join(gate(h), 'owner.json')); }
    if (variant === 'empty') fs.unlinkSync(path.join(gate(h), 'owner.json'));
    assert.equal(h.capture('unknown'), false); assert(fs.existsSync(gate(h))); assert.equal(h.launched.length, 0);
  }
  const replacedGate = harness(); const oldGateOwner = owner(dead); putGate(replacedGate, oldGateOwner);
  let replacedOnce = false;
  replacedGate.ctx.fs = { ...fs, linkSync(from, to) {
    if (!replacedOnce && to === path.join(gate(replacedGate), 'claim-0.json')) {
      replacedOnce = true; fs.renameSync(gate(replacedGate), gate(replacedGate) + '.old'); putGate(replacedGate, owner(dead));
    }
    return fs.linkSync(from, to);
  } };
  assert(replacedGate.capture('replacement-recovery'), 'claim bound to old gate cannot block new dead-owner recovery');
  assert(replacedGate.capture('second')); assert(!fs.existsSync(gate(replacedGate)));

  const deniedPid = harness(); deniedPid.ctx.process = { ...process, kill() { throw Object.assign(Error(), { code: 'EPERM' }); } };
  assert.equal(deniedPid.ctx.captureOwnerDead({ pid: 123, start: '1' }), false);
  assert.throws(() => deniedPid.ctx.captureOwnerDead({ pid: process.pid, start: {} }), /owner unknown/);
  const deniedMarker = harness(); deniedMarker.ctx.fs = { ...fs, writeFileSync(file, ...args) {
    if (String(file).endsWith('.pending')) throw Object.assign(Error('inert denied metadata'), { code: 'EACCES' }); return fs.writeFileSync(file, ...args);
  } };
  assert.equal(deniedMarker.capture('denied'), false); assert.equal(deniedMarker.names('slots').length, 0, 'explicit alternate home cleans pending-write failure');

  const atomic = harness(); assert(atomic.capture('atomic-handoff'));
  const atomicEnv = atomic.launched[0].env, originalSlot = fs.readFileSync(atomicEnv.RUVNET_LEARN_SLOT);
  atomic.ctx.fs = { ...fs, writeFileSync(file, data, ...args) {
    if (typeof file === 'number') { fs.writeSync(file, '{partial'); throw Object.assign(Error('inert full disk'), { code: 'ENOSPC' }); }
    return fs.writeFileSync(file, data, ...args);
  } };
  assert.throws(() => atomic.ctx.captureHandoff(atomic.home, atomicEnv.RUVNET_LEARN_SLOT, atomicEnv.RUVNET_LEARN_TOKEN, process.pid), error => error.code === 'ENOSPC');
  assert.deepEqual(fs.readFileSync(atomicEnv.RUVNET_LEARN_SLOT), originalSlot, 'torn staged handoff never truncates previous owner');
  assert.equal(atomic.names('slots').length, 1, 'owned failed stage cleaned');
  const tornCreate = harness(); tornCreate.ctx.fs = atomic.ctx.fs;
  assert.equal(tornCreate.capture('torn-create'), false); assert.equal(tornCreate.launched.length, 0); assert.equal(tornCreate.names('slots').length, 0);
  assert(tornCreate.failures.some(r => r.error === 'inert full disk'));
  const malformedSlot = harness(); assert(malformedSlot.capture('malformed'));
  const malformedPath = malformedSlot.launched[0].env.RUVNET_LEARN_SLOT;
  const malformedRecord = { pid: process.pid, token: malformedSlot.launched[0].env.RUVNET_LEARN_TOKEN, start: {} };
  fs.writeFileSync(malformedPath, JSON.stringify(malformedRecord));
  assert.equal(malformedSlot.capture('other'), false); assert.deepEqual(JSON.parse(fs.readFileSync(malformedPath)), malformedRecord);
  assert(malformedSlot.failures.some(r => r.error === 'capture slot owner unknown'));

  const cleanup = harness({ write() { putGate(cleanup, owner(process.pid)); } }); assert(cleanup.capture('cleanup-error')); cleanup.child();
  assert.equal(cleanup.writes, 1); assert(cleanup.failures.some(r => r.error === 'capture admission contended'));
  assert(cleanup.failures.filter(r => r.error === 'capture admission cleanup unavailable').length === 2, 'both cleanup failures remain visible after actual write');
  console.log('Capture ownership: native/historical composition, live/dead/unknown gate, token handoff, consent, failure cleanup, two authorized slots and native persistence boundaries PASS');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
