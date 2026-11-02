import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { EDITS, patchSource, reverseSource, isPatched } from '../lib/brain-capture-idempotency/patcher.mjs';
import { patchSource as diagnose, reverseSource as undiagnose, isPatched as diagnosed } from '../lib/brain-capture-diagnostics/patcher.mjs';
import { composeSource, COMPOSE_TARGETS } from '../lib/plugin-compose.mjs';
import { PLUGIN_TARGETS, PLUGIN_INFO } from '../lib/plugin-registry.mjs';

const fixture = name => fs.readFileSync(new URL(`./fixtures/brain-capture-diagnostics/${name}`, import.meta.url), 'utf8');
const native = fixture('turn-outcome-capture.mjs.part1') + fixture('turn-outcome-capture.mjs.part2');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
assert.equal(hash(native), 'e55c539a53fab2d9dc56be788c2af6df82b2083dd112fda74fb6631d720f2d34');
const patched = patchSource(native);
assert.deepEqual(patched.missing, []); assert(isPatched(patched.next));
assert.equal(patchSource(patched.next).next, patched.next);
assert.equal(reverseSource(patched.next), native);
const composed = diagnose(patched.next).next;
assert.equal(composed, patchSource(diagnose(native).next).next);
assert(diagnosed(composed) && isPatched(composed), 'each owner still recognizes exact composition');
assert.equal(undiagnose(reverseSource(composed)), native);
assert.equal(reverseSource(undiagnose(composed)), native);
assert(COMPOSE_TARGETS.includes('brain-capture-idempotency') && PLUGIN_TARGETS.includes('brain-capture-idempotency'));
assert(PLUGIN_INFO['brain-capture-idempotency'].includes('#520'));
assert.equal(composeSource(native, ['brain-capture-diagnostics', 'brain-capture-idempotency']), composed);
assert.equal(composeSource(diagnose(native).next, ['brain-capture-idempotency']), composed, 'existing diagnostics gain only retry proof');
for (const source of [native, patched.next, composed]) {
  const changed = source.replace("if (turn.actions.length) parts.push", "if (false) parts.push");
  assert(patchSource(changed).missing.length, 'unknown constructor semantics refuse application');
  assert(!isPatched(changed)); assert.equal(reverseSource(changed), changed);
}
for (const [, from, to] of EDITS) {
  assert(patchSource(native.replace(from, '// unknown upstream')).missing.length);
  assert(patchSource(native + '\n' + from).missing.length);
  const changed = patched.next.replace(to, '// unknown local edit');
  assert(!isPatched(changed)); assert(patchSource(changed).missing.length);
  assert.equal(reverseSource(changed), changed);
}
for (const source of [patched.next, composed]) assert.equal(spawnSync(process.execPath,
  ['--input-type=module', '--check'], { input: source, encoding: 'utf8' }).status, 0);

const section = (source, start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert(from >= 0 && to > from); return source.slice(from, to);
};
const plain = source => source.replace(/^import .*;\n/gm, '').replace(/\bexport /g, '');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-turn-idempotency-'));
let sequence = 0;
const atFirst = '2026-11-02T10:00:00.000Z', atRetry = '2026-11-02T11:00:00.000Z';
const outcome = 'The synthetic native turn concluded that exact committed data should retain its original capture time. '
  + 'All output fields must match the existing constructor, and a failed read remains unverified. '.repeat(2);
function harness(source) {
  const project = path.join(sandbox, 'project-' + sequence++), home = path.join(project, 'brain');
  fs.mkdirSync(home, { recursive: true });
  const db = path.join(project, 'inert-memory.db'), values = new Map(), failures = [], calls = [];
  let readUnavailable = false, readTerminal = {}, transformRead = value => value, mutateStep = step => step, beforeStore;
  const ctx = vm.createContext({ fs, os, path, crypto, Buffer, process, Date,
    resolveTurnDb: () => ({ projectRoot: project, db, scope: 'project', contentPathExcludes: [], capturePath: project }),
    storeEncryptedAtRest: () => false, resolveRuflo: () => '/inert/ruflo',
    rufloInvocation: (binary, args) => ({ executable: binary, args }),
    rufloRunDir: () => fs.mkdtempSync(path.join(project, 'scratch-')), rufloScratchRoot: () => project,
    nativeTurnLines: lines => lines, privateTurn: turn => turn,
    maskExcludedPaths: text => text, recordHookFailure: row => failures.push(row),
    failureScope: () => ({}), validFailureScope: () => ({}),
  });
  vm.runInContext(plain(section(fixture('continuity-events.mjs'), 'function canonicalize(', '/** Redact, then')), ctx, { timeout: 1000 });
  const privacy = fs.readFileSync(new URL('./fixtures/brain-native-4510/scripts/turn-capture-privacy.mjs', import.meta.url), 'utf8');
  vm.runInContext(plain(section(privacy, 'export function captureFailureReason(', '/** One notice')), ctx, { timeout: 1000 });
  // Run native parser/constructor/capture/worker bodies. Only process, consent and storage seams are inert.
  const body = section(source, 'const digest = ', 'function textOf(')
    + section(source, 'function textOf(', '/** Persisted per-canonical')
    + section(source, 'const projectName = ', '/** Bounded recent evidence');
  vm.runInContext(plain(body).replaceAll('fileURLToPath(import.meta.url)', "'/inert/turn-outcome-capture.mjs'"), ctx, { timeout: 1000 });
  const arg = (args, flag) => args[args.indexOf(flag) + 1];
  const run = (binary, args) => {
    calls.push(args[1]); assert.equal(arg(args, '--path'), db);
    const key = arg(args, '--key');
    if (args[1] === 'retrieve') return readUnavailable ? { status: 1, stderr: 'inert read unavailable' }
      : { status: 0, stdout: transformRead(values.get(key) ?? ''), ...readTerminal };
    assert.equal(args[1], 'store'); assert(args.includes('--append-only') && args.includes('--no-upsert'));
    if (beforeStore) { const hook = beforeStore; beforeStore = undefined; hook(key, arg(args, '--value')); }
    if (values.has(key)) return { status: 1, stderr: '[ERROR] immutable append rejected: logical key already exists' };
    values.set(key, arg(args, '--value')); return { status: 0 };
  };
  const transcript = actions => [{ type: 'user', message: { role: 'user', content: 'synthetic request' } },
    { type: 'assistant', message: { role: 'assistant', content: actions.map(description => ({ type: 'tool_use', name: 'Bash', input: { command: 'git status', description } })) } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: outcome }] } }].map(JSON.stringify);
  const capture = ({ at = atFirst, actions = ['Checked the synthetic source'], event = 'Stop', session = 'inert-session' } = {}) => ctx.captureTurnOutcome({
    projectDir: project, brainHome: home, ruflo: '/inert/ruflo', event, host: 'claude',
    payload: { session_id: session, transcript_path: '/inert/transcript' }, now: () => new Date(at),
    readTranscript: () => transcript(actions), run,
    launch: () => { throw Error('no detached work expected'); },
    write: (request, options) => ctx.runSteps({ ...request, steps: request.steps.map(mutateStep) }, options),
  });
  return { ctx, capture, home, db, project, values, calls, failures,
    set unavailable(value) { readUnavailable = value; }, set transform(value) { transformRead = value; },
    set terminal(value) { readTerminal = value; },
    set mutate(value) { mutateStep = value; }, set before(value) { beforeStore = value; } };
}
try {
  // Native control: the first write commits despite a missing receipt; the same turn cannot retry.
  const old = harness(native); old.unavailable = true;
  const oldFirst = old.capture(); assert.equal(oldFirst.recorded, false); assert.equal(old.values.size, 1);
  old.unavailable = false; const oldRetry = old.capture({ at: atRetry, event: 'SessionEnd' });
  assert.equal(oldRetry.key, oldFirst.key); assert.equal(oldRetry.recorded, false);
  assert.equal(oldRetry.receipt.error, 'duplicate turn key holds different content');
  assert.notEqual(oldRetry.value, old.values.get(oldRetry.key));

  for (const source of [patched.next, composed]) {
    const h = harness(source); h.unavailable = true;
    const first = h.capture(); assert.equal(first.recorded, false);
    const committed = h.values.get(first.key); h.unavailable = false;
    const retry = h.capture({ at: atRetry, event: 'SessionEnd' });
    assert.equal(retry.key, first.key); assert.equal(retry.recorded, true); assert.equal(retry.alreadyRecorded, true);
    assert.equal(retry.value, committed, 'report exposes the actual original committed value');
    assert.equal(h.values.get(first.key), committed, 'immutable original is never overwritten');
    assert.equal(retry.receipt.alreadyRecorded, true); assert.equal(retry.receipt.committedAt, atFirst);
    assert.equal(retry.receipt.committedValueSha256, hash(committed));
    assert.deepEqual(h.calls, ['store', 'retrieve', 'store', 'retrieve'], 'one append and one read per boundary; no replay');
    const receiptText = fs.readFileSync(path.join(h.home, 'turn-capture', 'receipts.jsonl'), 'utf8');
    assert(!receiptText.includes(outcome), 'receipts expose value identity, not another durable payload');
    assert.equal(h.capture({ at: atRetry }).skipped, 'same turn outcome already queued or verified');
    assert.equal(h.calls.length, 4, 'native dedup continues after exact existing-record proof');
  }

  const fresh = harness(composed), first = fresh.capture();
  assert.equal(first.recorded, true); assert.equal(first.alreadyRecorded, undefined);
  assert.equal(first.receipt.committedAt, undefined); assert.deepEqual(fresh.calls, ['store', 'retrieve']);
  const exact = harness(composed); exact.unavailable = true; exact.capture(); exact.unavailable = false;
  const equal = exact.capture(); assert.equal(equal.recorded, true); assert.equal(equal.alreadyRecorded, true);
  assert.equal(equal.receipt.committedAt, atFirst); assert.equal(equal.receipt.committedValueSha256, hash(equal.value));
  assert.deepEqual(exact.calls, ['store', 'retrieve', 'store', 'retrieve']);

  for (const mutate of [step => { delete step.turnRecord; return step; },
    step => ({ ...step, turnRecord: { ...step.turnRecord, project: 'spoofed' } }),
    step => ({ ...step, turnRecord: { ...step.turnRecord, host: 'spoofed' } }),
    step => ({ ...step, turnRecord: { ...step.turnRecord, session: 'spoofed' } }),
    step => ({ ...step, turnRecord: { ...step.turnRecord, turn: { ...step.turnRecord.turn, actions: ['spoofed'] } } })]) {
    const h = harness(composed); h.unavailable = true; h.capture(); h.unavailable = false; h.mutate = mutate;
    const retry = h.capture({ at: atRetry }); assert.equal(retry.recorded, false); assert.equal(retry.alreadyRecorded, undefined);
    assert.equal(retry.receipt.error, 'duplicate turn key holds different content'); assert.equal(h.values.size, 1);
  }
  const changed = harness(composed); changed.unavailable = true; const initial = changed.capture(); changed.unavailable = false;
  const differentActions = changed.capture({ at: atRetry, actions: ['A different substantive action'] });
  assert.equal(differentActions.key, initial.key, 'native key omits actions; this must not hide an action change');
  assert.equal(differentActions.recorded, false); assert.equal(differentActions.receipt.alreadyRecorded, undefined);

  for (const source of [patched.next, composed]) {
    for (const transform of [value => value.replace(atFirst, 'not-an-ISO-time'),
      value => value.replace(atFirst, '2026-02-31T10:00:00.000Z'),
      value => value.replace('OUTCOME:', 'ALTERED OUTCOME:'), value => value + ' trailing corruption',
      value => value + '\n', value => ' ' + value]) {
      const h = harness(source); h.unavailable = true; h.capture(); h.unavailable = false; h.transform = transform;
      const retry = h.capture({ at: atRetry }); assert.equal(retry.recorded, false); assert.equal(retry.alreadyRecorded, undefined);
      assert.deepEqual(h.calls, ['store', 'retrieve', 'store', 'retrieve']);
    }
    for (const terminal of [{ status: 1 }, { status: null }, { error: Object.assign(new Error('failed read'), { code: 'EIO' }) }, { signal: 'SIGTERM' }]) {
      const h = harness(source); h.unavailable = true; h.capture(); h.unavailable = false; h.terminal = terminal;
      const retry = h.capture({ at: atRetry }); assert.equal(retry.recorded, false); assert.equal(retry.alreadyRecorded, undefined);
      assert.deepEqual(h.calls, ['store', 'retrieve', 'store', 'retrieve']);
    }
  }
  const missing = harness(composed); missing.unavailable = true; missing.capture();
  assert.equal(missing.capture({ at: atRetry }).receipt.error, 'duplicate turn key could not be read back');
  assert.deepEqual(missing.calls, ['store', 'retrieve', 'store', 'retrieve']);

  // A concurrent writer wins after planning but before append. Only an identical full record qualifies.
  for (const conflicting of [false, true]) {
    const h = harness(composed);
    h.before = (key, value) => h.values.set(key, value.replace(atRetry, atFirst)
      .replace('Checked the synthetic source', conflicting ? 'Other writer changed the action' : 'Checked the synthetic source'));
    const result = h.capture({ at: atRetry }); assert.equal(result.recorded, !conflicting);
    assert.equal(result.alreadyRecorded, conflicting ? undefined : true);
    assert.deepEqual(h.calls, ['store', 'retrieve']); assert.equal(h.values.size, 1);
    if (!conflicting) assert.equal(result.value, h.values.get(result.key));
  }
  console.log('Brain#520: native timestamp retry failure reproduced; full constructor proof, committed value/time receipts, conflicts/read failures, concurrent append, no replay and exact composition PASS');
} finally { fs.rmSync(sandbox, { recursive: true, force: true }); }
