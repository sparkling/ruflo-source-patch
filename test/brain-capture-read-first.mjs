import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { patchRead, undoRead, isReading, READ_EDITS, PREVIOUS_TO } from '../lib/brain-capture-launch/learning-read-first.mjs';
import { patchSource as diagnose, reverseSource as undiagnose } from '../lib/brain-capture-diagnostics/patcher.mjs';
import * as capture from '../lib/brain-capture-launch/patcher.mjs';
import { addSteps, undoSteps } from '../lib/brain-capture-launch/step-timing.mjs';
import { composeSource } from '../lib/plugin-compose.mjs';
import { isKnownComposition } from '../lib/composition-proof.mjs';
import { descriptor as diagnosticsDescriptor } from '../lib/brain-capture-diagnostics/patcher.mjs';
const native = fs.readFileSync(new URL('./fixtures/brain-user-learning-root/learning-store-native-4.7.21.mjs', import.meta.url), 'utf8');
// Same published native learning-store bytes in installed Brain4.7.28's pristine baseline.
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
assert.equal(hash(native), 'c0792188abea5e3a8d95a97ca08e5013c8b4d21c190a152ed5a3b2dbe80b9b16');
const fixed = patchRead(native); assert.deepEqual(fixed.missing, []); assert(isReading(fixed.next));
assert.equal(patchRead(fixed.next).next, fixed.next); assert.equal(undoRead(fixed.next), native);
assert.equal(patchRead(diagnose(native).next).next, diagnose(fixed.next).next);
assert.equal(undiagnose(undoRead(diagnose(fixed.next).next)), native);
const timed = addSteps(fixed.next);
assert.equal(capture.patchSource(native).next, timed); assert(capture.isPatched(timed));
assert.equal(undoSteps(timed), fixed.next);
assert(isKnownComposition(native, fixed.next, [capture.descriptor]));
assert.equal(capture.reverseSource(fixed.next), native);
assert.equal(composeSource(diagnose(native).next, ['brain-capture-launch', 'brain-capture-diagnostics']), diagnose(timed).next);
for (const [, from, to] of READ_EDITS) {
  assert(patchRead(native.replace(from, '// foreign')).missing.length);
  assert(patchRead(native + from).missing.length);
  const changed = fixed.next.replace(to, '// foreign'); assert(!isReading(changed)); assert(patchRead(changed).missing.length);
  assert.equal(undoRead(changed), changed);
}
assert.equal(spawnSync(process.execPath, ['--input-type=module', '--check'], { input: fixed.next }).status, 0);
const observation = { tool: 'Bash', action: 'git status', session: 'inert-session' };
const value = JSON.stringify({ schemaVersion: 1, tool: observation.tool, action: observation.action, scope: 'project',
  authoritative: false, provenance: 'system-observation', outcome: 'host-reported-success' });
function run({ replies, source = timed, diagnosticStep, options = {}, allowed = () => true, db = '/inert/project/memory.db' } = {}) {
  const calls = [], stages = []; let targetCalls = 0;
  const ctx = vm.createContext({ Date, createHash: crypto.createHash, LEARNING_NAMESPACE: 'learning-observations',
    observationKey: row => 'workflow-' + hash(JSON.stringify([String(row.session), row.tool, row.action])),
    learningTarget: () => { targetCalls++; return db; },
    runLearningRuflo: (binary, argv, target, opts) => { calls.push({ binary, argv: [...argv], target, opts }); return replies(calls.length, argv, opts); },
    captureFailureReason: result => result.stderr || 'native refusal',
    failureScope: fields => Object.fromEntries(Object.keys(fields).map(key => [key, 'a'.repeat(16)])),
  });
  const begin = source.indexOf('export function recordLearningObservation('), end = source.indexOf('\n/**', begin);
  vm.runInContext(source.slice(begin, end).replace('export ', ''), ctx);
  let result, error;
  const selected = { deadline: Date.now() + 14000, env: { FIXTURE: 'unchanged' }, allowed, ...options };
  try { result = ctx.recordLearningObservation('/inert/ruflo', { enabled: true, scope: 'project', diagnosticStep: diagnosticStep || (row => stages.push(row)) }, observation, selected); }
  catch (caught) { error = caught; }
  assert.equal(targetCalls, 1);
  for (const call of calls) {
    assert.equal(call.binary, '/inert/ruflo'); assert.equal(call.target, db);
    assert.equal(call.argv.at(-1), db); assert.equal(call.opts.env, selected.env);
    assert.equal(call.opts.deadline, selected.deadline); assert.equal(call.opts.allowed, allowed);
  }
  return { result, error, calls, stages };
}
const exact = run({ replies: () => ({ status: 0, stdout: value }) });
assert.equal(exact.calls.length, 1); assert.equal(exact.calls[0].argv[1], 'retrieve');
assert.equal(exact.result.readOnlyDuplicate, true); assert.equal(exact.result.alreadyStored, true);
assert.equal(exact.result.exactCli, true); assert.equal(exact.result.digest, hash(value));
assert(exact.calls[0].opts.maxStepMs <= 2000);
// Detached child (14 s, two 6 s native steps): the whole 2000 ms slack, never a native step's share.
assert(exact.calls[0].opts.maxStepMs > 1900, 'loaded-host duplicate proof gets the full unreserved slack');
const tight = run({ options: { deadline: Date.now() + 12_500 }, replies: () => ({ status: 0, stdout: value }) });
assert(tight.calls[0].opts.maxStepMs <= 500, 'both native steps stay reserved');

// Released 4.46.119-151 bytes migrate exactly and reverse to native; never a second marker.
const released = native.replace(READ_EDITS[0][1], () => PREVIOUS_TO);
assert.notEqual(released, native); assert(!isReading(released));
assert.equal(patchRead(released).next, fixed.next); assert.deepEqual(patchRead(released).applied, ['native-exact-read-first-occupancy']);
assert.equal(undoRead(released), native);
assert.equal(capture.historicalPatchSource(native, released).next, released);
assert(isKnownComposition(native, diagnose(released).next, [capture.descriptor, diagnosticsDescriptor]));
assert.equal(capture.historicalPatchSource(native, released.replace('Math.min(1000,', 'Math.min(1001,')).next, native);
// A 1.2 s native CLI read misses the released budget, then pays store+readback.
// The candidate proves that same complete durable value with no write attempt.
const slowRead = (n, argv, opts) => argv[1] === 'retrieve' && opts.maxStepMs < 1200
  ? { status: null, error: { code: 'ETIMEDOUT' } }
  : argv[1] === 'store' ? { status: 1, stderr: 'already exists' }
    : { status: 0, stdout: value };
const slowReleased = run({ source: released, replies: slowRead });
const slowFixed = run({ replies: slowRead });
assert.deepEqual(slowReleased.calls.map(c => c.argv[1]), ['retrieve', 'store', 'retrieve']);
assert.deepEqual(slowFixed.calls.map(c => c.argv[1]), ['retrieve']);
assert.equal(slowFixed.result.digest, slowReleased.result.digest);
assert.equal(slowFixed.result.readOnlyDuplicate, true);
assert.equal(capture.patchSource(released).next, timed); assert.equal(capture.reverseSource(released), native);
assert(patchRead(released.replace('Math.min(1000,', 'Math.min(1001,')).missing.length, 'unknown edits of released bytes refused');

for (const initial of [
  { status: 0, stdout: '' }, { status: 0, stdout: 'different complete value' },
  { status: 1, stdout: value }, { status: null, error: { code: 'ETIMEDOUT' }, stdout: value },
]) {
  const fresh = run({ replies: n => n === 1 ? initial : n === 2 ? { status: 0 } : { status: 0, stdout: value } });
  assert(!fresh.error); assert.equal(fresh.result.exactCli, true); assert.equal(fresh.result.readOnlyDuplicate, undefined);
  assert.deepEqual(fresh.calls.map(c => c.argv[1]), ['retrieve', 'store', 'retrieve']);
  assert(fresh.calls[1].argv.includes('--no-upsert')); assert.equal(fresh.calls[1].argv[fresh.calls[1].argv.indexOf('--value') + 1], value);
}
const inline = run({ options: { deadline: Date.now() + 6000 }, replies: n => n === 1 ? { status: 0 } : { status: 0, stdout: value } });
assert.deepEqual(inline.calls.map(c => c.argv[1]), ['store', 'retrieve']);
const noConsent = run({ allowed: () => false, replies() { throw Error('must not dispatch'); } });
assert.equal(noConsent.calls.length, 0); assert.match(noConsent.error.message, /consent changed/);
let boundaries = 0;
const revoked = run({ allowed: () => ++boundaries === 1, replies: () => ({ status: 0, stdout: '' }) });
assert.deepEqual(revoked.calls.map(c => c.argv[1]), ['retrieve']); assert.match(revoked.error.message, /consent changed/);
const conflict = run({ replies: n => n === 2 ? { status: 1, stderr: 'already exists' } : { status: 0, stdout: 'conflict' } });
assert.match(conflict.error.message, /different observation/); assert.equal(conflict.calls.filter(c => c.argv[1] === 'store').length, 1);
const unknown = run({ replies: n => n === 1 ? { status: 0, stdout: '' } : { status: null, error: { code: 'ETIMEDOUT' } } });
assert(unknown.error); assert.equal(unknown.calls.filter(c => c.argv[1] === 'store').length, 1);
const recovered = run({ replies: n => n === 1 ? { status: 0, stdout: '' } : n === 2
  ? { status: null, error: { code: 'ETIMEDOUT' } } : { status: 0, stdout: value } });
assert.equal(recovered.result.alreadyStored, true); assert.equal(recovered.result.readOnlyDuplicate, undefined);
assert.equal(recovered.calls.filter(c => c.argv[1] === 'store').length, 1);
const sibling = run({ db: '/inert/other-project/memory.db', replies: () => ({ status: 0, stdout: value }) });
assert.equal(sibling.result.db, '/inert/other-project/memory.db');
console.log('Capture exact-read-first: native constructor/path/consent preserved, durable duplicate uses zero writes, full-slack bounded read budget, released-bytes migration, strict fresh insert/readback, conflict/timeout/unknown outcomes and exact inverse PASS');

assert.equal(exact.stages.length, 1); assert.equal(exact.stages[0].exactMatch, true);
assert.equal(exact.stages[0].operation, 'retrieve');
const measuredTimeout = run({ replies: n => n === 1 ? {status:null,error:{code:'ETIMEDOUT'}} : n === 2 ? {status:1,stderr:'already exists'} : {status:0,stdout:value} });
assert.deepEqual(measuredTimeout.stages.map(x => x.operation), ['retrieve','store','retrieve']);
assert.equal(measuredTimeout.stages[0].timedOut, true);
assert.equal(measuredTimeout.stages[2].exactMatch, true);
assert(!JSON.stringify(measuredTimeout.stages).includes('git status'));
assert(!JSON.stringify(measuredTimeout.stages).includes('already exists'));
const brokenSink = run({diagnosticStep:()=>{throw Error('sink failed');},replies:()=>({status:0,stdout:value})});
assert.equal(brokenSink.result.digest, exact.result.digest);
const thrown = run({replies:()=>{throw Error('native throw');}});
assert.match(thrown.error.message,/native throw/); assert.equal(thrown.stages[0].threw,true);
