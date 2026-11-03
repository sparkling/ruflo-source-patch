import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { EDITS, PREVIOUS_EDITS, patchSource, reverseSource, isPatched } from '../lib/brain-capture-launch/legacy.mjs';
import { patchSource as currentPatch } from '../lib/brain-capture-launch/patcher.mjs';
import { patchSource as diagnose, reverseSource as undiagnose } from '../lib/brain-capture-diagnostics/patcher.mjs';
import { composeSource, COMPOSE_TARGETS } from '../lib/plugin-compose.mjs';
import { PLUGIN_TARGETS, PLUGIN_INFO } from '../lib/plugin-registry.mjs';

const native = fs.readFileSync(new URL('./fixtures/brain-learning-receipts/native-4.7.28.mjs', import.meta.url), 'utf8');
// Brain4.7.28/current main blob751c071b9c71ad28ddbfa66e80ad2781f3479863, verified2026-11-02.
assert.equal(crypto.createHash('sha256').update(native).digest('hex'), 'cf9fb218c5e51cdb29298801cb5634f864c9bb73b93926afac505624a4fd3edc');
const fixed = patchSource(native);
const previous = PREVIOUS_EDITS.reduce((text, [, from, to]) => text.replace(from, () => to), native);
assert.equal(crypto.createHash('sha256').update(previous).digest('hex'), 'fa3f72c1bd95a76459f25d227e291948725f2d1c2bc385f0054c05b50e9d70ee');
assert(!isPatched(previous), 'previous launch repair still needs admission repair');
assert.equal(patchSource(previous).next, fixed.next);
assert.equal(reverseSource(previous), native);
assert.equal(patchSource(diagnose(previous).next).next, diagnose(fixed.next).next);
assert.equal(undiagnose(reverseSource(diagnose(previous).next)), native);
const changedPrevious = previous.replace('return token;', 'return null; // unowned edit');
assert.equal(patchSource(changedPrevious).next, changedPrevious); assert(patchSource(changedPrevious).missing.length);
assert.equal(reverseSource(changedPrevious), changedPrevious);
assert.deepEqual(fixed.missing, []);
assert(isPatched(fixed.next));
assert.equal(patchSource(fixed.next).next, fixed.next);
assert.equal(reverseSource(fixed.next), native);
assert.equal(diagnose(fixed.next).next, patchSource(diagnose(native).next).next, 'diagnostics compose in either order');
assert.equal(undiagnose(reverseSource(diagnose(fixed.next).next)), native, 'both owners uninstall exactly');
assert.equal(reverseSource(undiagnose(diagnose(fixed.next).next)), native);
assert(COMPOSE_TARGETS.includes('brain-capture-launch') && PLUGIN_TARGETS.includes('brain-capture-launch'));
assert(PLUGIN_INFO['brain-capture-launch'].includes('#519'));
assert.equal(composeSource(native, ['brain-capture-diagnostics', 'brain-capture-launch']), diagnose(currentPatch(native).next).next);
assert.equal(composeSource(diagnose(native).next, ['brain-capture-launch']), diagnose(currentPatch(native).next).next, 'existing diagnostics gain only the launch fix');
assert.equal(composeSource(diagnose(previous).next, ['brain-capture-launch']), diagnose(currentPatch(native).next).next, 'released composition upgrades exactly');
for (const [, from, to] of EDITS) {
  assert(patchSource(native.replace(from, '// unknown source')).missing.length);
  assert(patchSource(native + '\n' + from).missing.length);
  const changed = fixed.next.replace(to, '// external edit');
  assert(!isPatched(changed)); assert(patchSource(changed).missing.length);
  assert.equal(reverseSource(changed), changed);
}
assert.equal(spawnSync(process.execPath, ['--input-type=module', '--check'], { input: fixed.next, encoding: 'utf8' }).status, 0);
assert.equal(fixed.next.slice(fixed.next.indexOf('function runDetached(')), native.slice(native.indexOf('function runDetached(')), 'child consent, write, readback and cleanup remain native bytes');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-capture-launch-'));
let number = 0;
const keyOf = observation => crypto.createHash('sha256').update(JSON.stringify(observation)).digest('hex');
const input = session => ({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'git status' }, session_id: session, cwd: '/inert/project' });
const child = (pid = process.pid) => Object.assign(new EventEmitter(), { pid, unref() {} });
function harness(source, launch) {
  const home = path.join(sandbox, String(number++));
  const failures = []; let attempts = 0, writes = 0, lastChild;
  const ctx = vm.createContext({ fs, os, path, process, Date, randomUUID: crypto.randomUUID,
    learningContext: () => ({ enabled: true }), resolveRuflo: () => '/inert/ruflo', observationKey: keyOf,
    recordLearningObservation: () => { writes++; }, distillObservations: () => { writes++; },
    recordHookFailure: row => failures.push(row),
    failureScope: fields => Object.fromEntries(Object.keys(fields).map(key => [key, 'a'.repeat(16)])),
    validFailureScope: fields => fields,
    spawn: (...args) => { attempts++; lastChild = launch(...args); return lastChild; },
  });
  const body = source.slice(source.indexOf('// LOAD BOUNDS'), source.indexOf('\nconst isMain ='))
    .replace(/\bexport /g, '').replace('fileURLToPath(import.meta.url)', "'/inert/learn-capture.mjs'");
  vm.runInContext(body, ctx, { timeout: 1000 });
  const names = sub => {
    const dir = path.join(home, 'learn-capture', sub);
    return fs.existsSync(dir) ? fs.readdirSync(dir).map(name => path.join(dir, name)) : [];
  };
  return { home, ctx, failures, names, capture: session => ctx.captureLearning(input(session), { brainHome: home, detach: true }),
    get attempts() { return attempts; }, get writes() { return writes; }, get child() { return lastChild; } };
}
try {
  // Both callers observed an absent pending marker before either reserved it. B launches
  // while A still holds its prior stat result; only one fresh same-key admission should survive.
  for (const source of [native, previous, fixed.next, diagnose(fixed.next).next]) {
    const sessions = [];
    const raced = harness(source, (_binary, _args, options) => {
      sessions.push(JSON.parse(options.env.RUVNET_LEARN_OBSERVATION).session); return child();
    });
    let entered = false, innerResult, retainedPending;
    raced.ctx.fs = { ...fs, statSync(file, ...args) {
      try { return fs.statSync(file, ...args); } catch (error) {
        if (!entered && String(file).endsWith('.pending') && error.code === 'ENOENT') {
          entered = true; innerResult = raced.capture('same-race'); raced.child.emit('spawn');
          retainedPending = fs.readFileSync(raced.names('recent')[0]);
        }
        throw error;
      }
    } };
    assert.equal(raced.capture('same-race'), true); assert.equal(innerResult, true);
    const repaired = isPatched(source);
    assert.equal(raced.attempts, repaired ? 1 : 2);
    if (repaired) assert.deepEqual(fs.readFileSync(raced.names('recent')[0]), retainedPending, 'coalescing preserves the live owner token');
    assert.equal(raced.capture('distinct-race'), repaired);
    assert.equal(raced.capture('over-cap'), false, 'unique observations still obey native two-slot admission');
    assert.deepEqual(sessions, repaired ? ['same-race', 'distinct-race'] : ['same-race', 'same-race']);
    assert.equal(raced.names('slots').length, 2); assert.equal(raced.writes, 0);
    assert(raced.names('recent').every(file => file.endsWith('.pending')), 'coalescing never acknowledges persistence');
    assert.equal(raced.failures.at(-1).error, 'shed observation (load)');
  }

  // Execute the actual native defect before checking the repaired function.
  let refuse = true;
  const failThenStart = () => { if (refuse) throw Object.assign(Error('private argv must not appear'), { code: 'EAGAIN' }); return child(); };
  const before = harness(native, failThenStart);
  assert.equal(before.capture('one'), false); assert.equal(before.capture('two'), false);
  refuse = false; assert.equal(before.capture('three'), false);
  assert.equal(before.attempts, 2); assert.equal(before.names('slots').length, 2);
  assert.equal(before.names('recent').length, 2); assert.equal(before.writes, 0);
  assert.equal(before.failures.at(-1).error, 'shed observation (load)');

  for (const source of [fixed.next, diagnose(fixed.next).next]) {
    refuse = true; const after = harness(source, failThenStart);
    assert.equal(after.capture('one'), false); assert.equal(after.capture('two'), false);
    assert.equal(after.names('slots').length, 0); assert.equal(after.names('recent').length, 0);
    assert.deepEqual(after.failures.map(row => row.error), ['detach failed: EAGAIN', 'detach failed: EAGAIN']);
    refuse = false; assert.equal(after.capture('three'), true);
    assert.equal(after.attempts, 3); assert.equal(after.writes, 0);
    assert.equal(after.names('slots').length, 1); assert.equal(after.names('recent').length, 1);
    assert(!JSON.stringify(after.failures).includes('private argv'));
    if (source !== fixed.next) assert.equal(after.failures[0].session, 'a'.repeat(16), 'existing scoped diagnostics retained');
  }

  // A real Node failed spawn: no executable or database runs. Await its bounded close event.
  let closed;
  const asyncFailure = harness(fixed.next, (binary, args, options) => {
    const c = spawn(path.join(sandbox, 'nonexistent-executable'), args, options);
    closed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('failed spawn did not close')), 2000);
      c.once('close', () => { clearTimeout(timer); resolve(); });
    });
    return c;
  });
  assert.equal(asyncFailure.capture('real-negative-spawn'), true, 'submission is not verified capture');
  await closed;
  assert.equal(asyncFailure.failures.at(-1).error, 'detach failed: ENOENT');
  assert.equal(asyncFailure.names('slots').length, 0); assert.equal(asyncFailure.names('recent').length, 0);
  assert.equal(asyncFailure.writes, 0);

  const unknown = harness(fixed.next, () => child());
  assert.equal(unknown.capture('started'), true);
  unknown.child.emit('spawn');
  const pending = unknown.names('recent')[0], slot = unknown.names('slots')[0];
  const pendingBefore = fs.readFileSync(pending), slotBefore = fs.readFileSync(slot);
  unknown.child.emit('error', Object.assign(Error('private unknown write'), { code: 'EPIPE' }));
  unknown.child.emit('exit', 1, null);
  assert.deepEqual(fs.readFileSync(pending), pendingBefore, 'post-spawn unknown write keeps pending');
  assert.deepEqual(fs.readFileSync(slot), slotBefore, 'post-spawn errors never reclaim the child slot');
  assert.equal(unknown.failures.at(-1).error, 'detached child error: EPIPE');
  assert.equal(unknown.capture('started'), true); assert.equal(unknown.attempts, 1, 'native pending coalescing retained');
  assert.equal(unknown.capture('second-live'), true);
  assert.equal(unknown.capture('third-live'), false);
  assert.equal(unknown.attempts, 2, 'two native slots remain the limit');
  assert.equal(unknown.failures.at(-1).error, 'shed observation (load)');

  const afterSpawnCall = harness(fixed.next, () => Object.assign(child(), { unref() { throw Error('unknown child state'); } }));
  assert.equal(afterSpawnCall.capture('unknown-after-spawn-call'), false);
  assert.equal(afterSpawnCall.names('slots').length, 1);
  assert.equal(afterSpawnCall.names('recent').length, 1, 'an exception after spawn returned is not proof that no write ran');

  // Retained #519 protects a replacement only when its filesystem identity changed.
  // Same-inode/coarse-timestamp replacement was a real legacy weakness (Linux qualification);
  // current admission-token safety is tested separately in brain-capture-launch-ownership.mjs.
  const replaced = harness(fixed.next, () => child(undefined));
  assert.equal(replaced.capture('replaced'), true);
  const ownPending = replaced.names('recent')[0], ownSlot = replaced.names('slots')[0];
  fs.unlinkSync(ownPending); fs.writeFileSync(ownPending, 'foreign pending');
  fs.writeFileSync(ownSlot, JSON.stringify({ pid: process.pid, at: Date.now() + 1, foreign: true }));
  fs.utimesSync(ownSlot, new Date(0), new Date(0)); // deliberately different identity, independent of filesystem clock granularity
  replaced.child.emit('error', Object.assign(Error('not started'), { code: 'EAGAIN' }));
  replaced.child.emit('error', Error('repeated error'));
  assert.equal(fs.readFileSync(ownPending, 'utf8'), 'foreign pending');
  assert.equal(JSON.parse(fs.readFileSync(ownSlot)).foreign, true);
  assert.equal(replaced.failures.length, 1, 'one failed launch produces one diagnostic');

  // An older writer can still refresh a marker after A's exclusive creation. Simulate
  // that mixed-version caller directly; failed launch cleanup must retain its live pending.
  for (const outerFails of [true, false]) {
    let launches = 0, entered = false, innerResult;
    const concurrent = harness(fixed.next, () => {
      launches++;
      if (launches === (outerFails ? 2 : 1)) throw Object.assign(Error('inert overlap failure'), { code: 'EAGAIN' });
      return child();
    });
    const observation = { tool: 'Bash', action: 'git status', session: 'same-overlap' };
    concurrent.ctx.fs = { ...fs, writeFileSync(file, data, options) {
      fs.writeFileSync(file, data, options);
      if (entered || !String(file).endsWith('.pending')) return;
      entered = true;
      const slot = concurrent.ctx.acquireObserveSlot(concurrent.home);
      assert(slot, 'B independently passed native admission');
      fs.writeFileSync(file, '', { mode: 0o600 });
      const admissionToken = null; // native/previous refresh cannot claim exclusive pending ownership
      innerResult = concurrent.ctx.detachLearning('--observe', { brainHome: concurrent.home, observation, slot, admissionToken });
      if (innerResult) concurrent.child.emit('spawn');
    } };
    assert.equal(concurrent.capture('same-overlap'), !outerFails);
    assert.equal(innerResult, outerFails);
    assert.equal(concurrent.attempts, 2); assert.equal(concurrent.writes, 0);
    assert.equal(concurrent.names('slots').length, 1, 'failed attempt releases only its own slot');
    assert.equal(concurrent.names('recent').length, 1, 'live overlapping capture keeps its pending');
    assert.equal(fs.readFileSync(concurrent.names('recent')[0], 'utf8'), '');
    assert.equal(concurrent.capture('same-overlap'), true);
    assert.equal(concurrent.attempts, 2, 'native same-key coalescing remains active');
  }

  const stale = harness(fixed.next, () => { throw Object.assign(Error('failed fresh attempt'), { code: 'EAGAIN' }); });
  const staleObservation = { tool: 'Bash', action: 'git status', session: 'stale-pending' };
  const staleDir = path.join(stale.home, 'learn-capture', 'recent'); fs.mkdirSync(staleDir, { recursive: true });
  const staleMarker = path.join(staleDir, keyOf(staleObservation) + '.pending');
  fs.writeFileSync(staleMarker, ''); fs.utimesSync(staleMarker, new Date(0), new Date(0));
  assert.equal(stale.capture('stale-pending'), false);
  assert.equal(stale.attempts, 1, 'stale pending still permits native admission');
  assert.equal(stale.names('slots').length, 0);
  assert.equal(fs.readFileSync(staleMarker, 'utf8'), '', 'unowned preexisting marker is retained conservatively');
  assert(stale.ctx.captureInFlight(stale.home, keyOf(staleObservation)), 'native stale-marker refresh is unchanged');

  // A observes an expired marker; B refreshes it and starts before A resumes that old stat.
  // A must coalesce with the now-fresh marker, not overwrite it or retain another slot.
  const refreshed = harness(fixed.next, () => child());
  const refreshedKey = keyOf({ tool: 'Bash', action: 'git status', session: 'refresh-race' });
  const refreshedDir = path.join(refreshed.home, 'learn-capture', 'recent'); fs.mkdirSync(refreshedDir, { recursive: true });
  const refreshedMarker = path.join(refreshedDir, refreshedKey + '.pending');
  fs.writeFileSync(refreshedMarker, ''); fs.utimesSync(refreshedMarker, new Date(0), new Date(0));
  let refreshedOnce = false, refreshedMtime;
  refreshed.ctx.fs = { ...fs, statSync(file, ...args) {
    const result = fs.statSync(file, ...args);
    if (!refreshedOnce && file === refreshedMarker) {
      refreshedOnce = true; assert.equal(refreshed.capture('refresh-race'), true); refreshed.child.emit('spawn');
      refreshedMtime = fs.statSync(refreshedMarker).mtimeMs;
    }
    return result;
  } };
  assert.equal(refreshed.capture('refresh-race'), true); assert.equal(refreshed.attempts, 1);
  assert.equal(refreshed.names('slots').length, 1); assert.equal(refreshed.writes, 0);
  assert.equal(fs.statSync(refreshedMarker).mtimeMs, refreshedMtime);
  assert.equal(fs.readFileSync(refreshedMarker, 'utf8'), '');
  assert.equal(refreshed.capture('distinct-after-refresh'), true);

  const denied = harness(fixed.next, () => child());
  denied.ctx.learningContext = () => ({ enabled: false });
  assert.equal(denied.capture('consent-denied'), false); assert.equal(denied.attempts, 0);
  assert.equal(denied.names('slots').length, 0); assert.equal(denied.names('recent').length, 0);
  const revoked = harness(fixed.next, () => child());
  assert.equal(revoked.capture('consent-revoked'), true); revoked.child.emit('spawn');
  revoked.ctx.learningContext = () => ({ enabled: false });
  revoked.ctx.process = { ...process, env: { RUVNET_BRAIN_HOME: revoked.home,
    RUVNET_LEARN_OBSERVATION: JSON.stringify({ tool: 'Bash', action: 'git status', session: 'consent-revoked' }),
    RUVNET_LEARN_SLOT: revoked.names('slots')[0] } };
  revoked.ctx.runDetached('--observe');
  assert.equal(revoked.writes, 0); assert.equal(revoked.names('slots').length, 0);
  assert(revoked.names('recent').every(file => file.endsWith('.pending')), 'revoked consent never acknowledges capture');

  const markerUnavailable = harness(fixed.next, () => child());
  markerUnavailable.ctx.fs = { ...fs, mkdirSync(dir, options) {
    if (String(dir).endsWith('/recent')) throw Object.assign(Error('inert denied marker'), { code: 'EACCES' });
    return fs.mkdirSync(dir, options);
  } };
  assert.equal(markerUnavailable.capture('no-marker'), true, 'best-effort marker failure does not replace native launch');
  assert.equal(markerUnavailable.attempts, 1);

  const normal = harness(fixed.next, () => child());
  assert.equal(normal.capture('verified'), true);
  normal.child.emit('spawn');
  const observation = { tool: 'Bash', action: 'git status', session: 'verified' };
  normal.ctx.process = { ...process, env: { RUVNET_BRAIN_HOME: normal.home,
    RUVNET_LEARN_OBSERVATION: JSON.stringify(observation), RUVNET_LEARN_SLOT: normal.names('slots')[0] } };
  normal.ctx.runDetached('--observe');
  assert.equal(normal.writes, 1); assert.equal(normal.names('slots').length, 0);
  assert.equal(normal.names('recent').length, 1);
  assert.equal(path.basename(normal.names('recent')[0]), keyOf(observation), 'only native successful readback acknowledges capture');

  const distill = harness(fixed.next, () => { throw Object.assign(Error('private distill args'), { code: 'ERR_INVALID_ARG_TYPE' }); });
  assert.equal(distill.ctx.detachLearning('--distill', { brainHome: distill.home }), false);
  assert.equal(distill.failures[0].hook, 'learn-distill'); assert.equal(distill.failures[0].event, 'SessionEnd');
  assert.equal(distill.failures[0].error, 'detach failed: ERR_INVALID_ARG_TYPE');
  assert.equal(distill.writes, 0);
  console.log('Brain#519/#521: native launch leak and duplicate admission reproduced; fresh coalescing, stale renewal/replacement, consent, live/foreign preservation, two-slot shedding and previous composition upgrade/reverse PASS');
} finally { fs.rmSync(sandbox, { recursive: true, force: true }); }
