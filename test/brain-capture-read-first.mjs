import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { patchRead, undoRead, isReading, READ_EDITS } from '../lib/brain-capture-launch/learning-read-first.mjs';
import { patchSource as diagnose, reverseSource as undiagnose } from '../lib/brain-capture-diagnostics/patcher.mjs';
import * as capture from '../lib/brain-capture-launch/patcher.mjs';
import { composeSource } from '../lib/plugin-compose.mjs';
const native = fs.readFileSync(new URL('./fixtures/brain-user-learning-root/learning-store-native-4.7.21.mjs', import.meta.url), 'utf8');
// Same published native learning-store bytes in installed Brain4.7.28's pristine baseline.
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
assert.equal(hash(native), 'c0792188abea5e3a8d95a97ca08e5013c8b4d21c190a152ed5a3b2dbe80b9b16');
const fixed = patchRead(native); assert.deepEqual(fixed.missing, []); assert(isReading(fixed.next));
assert.equal(patchRead(fixed.next).next, fixed.next); assert.equal(undoRead(fixed.next), native);
assert.equal(patchRead(diagnose(native).next).next, diagnose(fixed.next).next);
assert.equal(undiagnose(undoRead(diagnose(fixed.next).next)), native);
assert.equal(capture.patchSource(native).next, fixed.next); assert(capture.isPatched(fixed.next));
assert.equal(capture.reverseSource(fixed.next), native);
assert.equal(composeSource(diagnose(native).next, ['brain-capture-launch', 'brain-capture-diagnostics']), diagnose(fixed.next).next);
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
function run({ replies, source = fixed.next, options = {}, allowed = () => true, db = '/inert/project/memory.db' } = {}) {
  const calls = []; let targetCalls = 0;
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
  try { result = ctx.recordLearningObservation('/inert/ruflo', { enabled: true, scope: 'project' }, observation, selected); }
  catch (caught) { error = caught; }
  assert.equal(targetCalls, 1);
  for (const call of calls) {
    assert.equal(call.binary, '/inert/ruflo'); assert.equal(call.target, db);
    assert.equal(call.argv.at(-1), db); assert.equal(call.opts.env, selected.env);
    assert.equal(call.opts.deadline, selected.deadline); assert.equal(call.opts.allowed, allowed);
  }
  return { result, error, calls };
}
const exact = run({ replies: () => ({ status: 0, stdout: value }) });
assert.equal(exact.calls.length, 1); assert.equal(exact.calls[0].argv[1], 'retrieve');
assert.equal(exact.result.readOnlyDuplicate, true); assert.equal(exact.result.alreadyStored, true);
assert.equal(exact.result.exactCli, true); assert.equal(exact.result.digest, hash(value));
assert(exact.calls[0].opts.maxStepMs <= 1000);

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
console.log('Capture exact-read-first: native constructor/path/consent preserved, durable duplicate uses zero writes, bounded read budget, strict fresh insert/readback, conflict/timeout/unknown outcomes and exact inverse PASS');
