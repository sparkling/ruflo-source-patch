import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { patchSource, reverseSource, isPatched, historicalPatchSource } from '../lib/brain-capture-launch/patcher.mjs';
import { TIMING_EDITS, undoTiming } from '../lib/brain-capture-launch/diagnostics.mjs';
import { undoWait } from '../lib/brain-capture-launch/backpressure.mjs';
import { undoSteps } from '../lib/brain-capture-launch/step-timing.mjs';
import { patchSource as diagnose, reverseSource as undiagnose } from '../lib/brain-capture-diagnostics/patcher.mjs';
import { composeSource } from '../lib/plugin-compose.mjs';

const native = fs.readFileSync(new URL('./fixtures/brain-learning-receipts/native-4.7.28.mjs', import.meta.url), 'utf8');
const candidate = patchSource(native); assert.deepEqual(candidate.missing, []);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const keyOf = ({ session = '', tool, action }) => 'workflow-' + hash(JSON.stringify([String(session), tool, action]));
const root = process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-capture-timing-'));
let ordinal = 0;
function harness({ write, facade = fs, sameBucket = false, enabled = true } = {}) {
  const home = path.join(root, String(ordinal++)), log = path.join(home, '.ruflo-source-patch/capture-diagnostics');
  const launched = [], failures = []; let writes = 0, id = 0;
  const env = { ...process.env, RUFLO_SOURCE_PATCH_HOME: home, RSP_CAPTURE_DIAGNOSTICS: enabled ? 'on' : 'off' };
  const context = vm.createContext({ fs: facade, os, path, Date, process: { ...process, env }, Buffer,
    captureTimingHash: crypto.createHash,
    failureScope: fields => Object.fromEntries(Object.entries(fields).filter(([, value]) => typeof value === 'string' && value.length > 0 && value.length <= 8192).map(([key, value]) => [key, hash(value).slice(0, 16)])),
    validFailureScope: fields => Object.fromEntries(Object.entries(fields).filter(([, value]) => /^[a-f0-9]{16}$/.test(value))),
    randomUUID: sameBucket ? () => '00000000-0000-4000-8000-' + String(++id).padStart(12, '0') : crypto.randomUUID,
    learningContext: () => ({ enabled: true }), resolveRuflo: () => '/inert/ruflo', observationKey: keyOf,
    recordLearningObservation: (...args) => { writes++; return write?.(context, ...args)
      ?? { exactCli: true, alreadyStored: true, db: '/private/store.db', key: keyOf(args[2]) }; },
    distillObservations() {}, recordHookFailure: row => failures.push(row),
    spawn: (_binary, _args, options) => { launched.push(options); return Object.assign(new EventEmitter(), { pid: process.pid, unref() {} }); },
  });
  const composed = diagnose(candidate.next).next;
  vm.runInContext(composed.slice(composed.indexOf('// LOAD BOUNDS'), composed.indexOf('\nconst isMain ='))
    .replace(/\bexport /g, '').replace('fileURLToPath(import.meta.url)', "'/inert/capture.mjs'"), context);
  // This suite isolates timing; real bounded admission waits have their own process tests.
  context.captureWaitAdmit = (home, key) => context.captureAdmit(home, key);
  const input = session => ({ hook_event_name: 'PostToolUse', tool_name: 'Bash',
    tool_input: { command: 'git status private-command-secret' }, session_id: session, cwd: '/private/project' });
  return { home, log, env, context, launched, failures, input,
    capture: (session, detach = true) => context.captureLearning(input(session), { brainHome: home, detach }),
    child(index = launched.length - 1) { context.process.env = launched[index].env; context.runDetached('--observe'); },
    rows: () => fs.existsSync(log) ? fs.readdirSync(log).map(name => JSON.parse(fs.readFileSync(path.join(log, name)))) : [],
    get writes() { return writes; },
  };
}
// Real FIFO and check/open replacement run in a kill-bounded subprocess, never in the main test runner.
if (process.argv[2] === '--fifo') {
  const race = process.argv[4] === 'race'; let replaced = false;
  const h = harness({ sameBucket: true, facade: { ...fs, openSync(file, flags, ...args) {
    if (race && String(file).endsWith('/capture-0.json') && !replaced) {
      replaced = true; fs.unlinkSync(file);
      assert.equal(spawnSync('mkfifo', ['-m', '600', file]).status, 0);
    }
    return fs.openSync(file, flags, ...args);
  } } });
  fs.mkdirSync(h.log, { recursive: true, mode: 0o700 });
  const file = path.join(h.log, 'capture-0.json');
  if (race) fs.writeFileSync(file, '{}', { mode: 0o600 });
  else assert.equal(spawnSync('mkfifo', ['-m', '600', file]).status, 0);
  assert.equal(h.capture('fifo-secret', false), true); assert.equal(h.writes, 1);
  assert(fs.lstatSync(file).isFIFO()); console.log('FIFO diagnostics refused; native success unchanged');
} else try {
  const uninstrumented = undoTiming(undoWait(undoSteps(candidate.next)));
  assert(isPatched(candidate.next)); assert.equal(reverseSource(candidate.next), native);
  assert.equal(patchSource(uninstrumented).next, candidate.next);
  assert.equal(historicalPatchSource(native, uninstrumented).next, uninstrumented);
  for (const source of [uninstrumented, diagnose(uninstrumented).next]) {
    assert.equal(composeSource(source, ['brain-capture-launch', 'brain-capture-diagnostics']), diagnose(candidate.next).next);
  }
  assert.equal(undiagnose(reverseSource(diagnose(candidate.next).next)), native);
  assert.equal(patchSource(diagnose(native).next).next, diagnose(candidate.next).next);
  for (const [, , to] of TIMING_EDITS) {
    const timed = undoWait(undoSteps(candidate.next)), changed = timed.replace(to, '// foreign change');
    assert.notEqual(changed, timed); assert(!isPatched(changed));
    assert(patchSource(changed).missing.length); assert.equal(reverseSource(changed), changed);
  }
  assert.equal(spawnSync(process.execPath, ['--input-type=module', '--check'], { input: candidate.next }).status, 0);

  const h = harness(); assert(h.capture('private-session-a')); assert(h.capture('private-session-b'));
  assert.equal(h.capture('private-session-c'), false); assert.equal(h.launched.length, 2);
  assert.equal(h.capture('private-session-a'), true); assert.equal(h.launched.length, 2); assert.equal(h.writes, 0);
  let rows = h.rows();
  const full = rows.find(row => row.events.some(e => e.phase === 'admission' && e.outcome === 'slots-full'));
  assert(full); assert.equal(full.returned, false);
  assert.equal(full.events.filter(e => e.phase === 'slot-read' && e.ownerPid === process.pid).length, 2);
  assert(rows.some(row => row.events.some(e => e.phase === 'coalesced-pending')));
  h.child(0); h.child(1); assert.equal(h.writes, 2);
  assert.equal(fs.readdirSync(path.join(h.home, 'learn-capture/slots')).length, 0);
  rows = h.rows();
  const child = rows.find(row => row.mode === 'child'); assert(child);
  for (const phase of ['adoption', 'native-store-readback', 'ack-prune', 'slot-release']) assert(child.events.some(e => e.phase === phase), phase);
  const evidence = child.events.find(e => e.phase === 'native-result');
  assert.equal(evidence.exactCli, true); assert.equal(evidence.alreadyStored, true);
  assert.equal(evidence.store, hash('/private/store.db').slice(0, 16));
  assert(child.events.some(e => e.phase === 'gate' && e.waitMs >= 0 && e.heldMs >= 0));
  assert.equal(child.project, hash('/private/project').slice(0, 16), 'child scope follows parent diagnostic envelope');
  const bytes = JSON.stringify(rows);
  for (const forbidden of ['/private/', 'private-session', 'private-command-secret', 'workflow-']) assert(!bytes.includes(forbidden), forbidden);
  assert(h.capture('private-session-a')); assert.equal(h.launched.length, 2);
  assert(h.rows().some(row => row.events.some(e => e.phase === 'coalesced-recent')));

  const contended = harness(); const gate = path.join(contended.home, 'learn-capture/admission.lock');
  fs.mkdirSync(gate, { recursive: true }); fs.writeFileSync(path.join(gate, 'owner.json'), JSON.stringify({ pid: process.pid, start: null, token: crypto.randomUUID() }));
  assert.equal(contended.capture('gate-secret'), false); assert.equal(contended.launched.length, 0);
  const refused = contended.rows()[0];
  assert(refused.events.some(e => e.phase === 'gate' && e.reason === 'capture admission contended' && e.heldMs === null));
  assert.equal(contended.failures[0].error, 'capture admission contended'); assert(fs.existsSync(gate));

  const failure = harness({ write() { throw Object.assign(Error('private-error-secret'), { code: 'EIO' }); } });
  assert.equal(failure.capture('failed-secret', false), false); assert.equal(failure.writes, 1);
  assert(failure.rows()[0].events.some(e => e.phase === 'native-store-readback-failed' && e.reason === 'EIO'));
  assert(!JSON.stringify(failure.rows()).includes('private-error-secret'));
  const off = harness({ enabled: false }); assert(off.capture('off', false)); assert(!fs.existsSync(off.log));
  const noLog = harness({ facade: { ...fs, mkdirSync(file, ...args) {
    if (String(file).includes('capture-diagnostics')) throw Object.assign(Error('disk full'), { code: 'ENOSPC' });
    return fs.mkdirSync(file, ...args);
  } } });
  assert(noLog.capture('no-log', false)); assert.equal(noLog.writes, 1); assert.equal(noLog.failures.length, 0);

  for (const kind of ['symlink', 'hardlink', 'public']) {
    const unsafe = harness({ sameBucket: true }), target = path.join(root, kind + '-target');
    fs.mkdirSync(unsafe.log, { recursive: true, mode: 0o700 }); fs.writeFileSync(target, 'preserve', { mode: 0o600 });
    const file = path.join(unsafe.log, 'capture-0.json');
    if (kind === 'symlink') fs.symlinkSync(target, file);
    if (kind === 'hardlink') fs.linkSync(target, file);
    if (kind === 'public') { fs.writeFileSync(file, 'preserve', { mode: 0o644 }); fs.chmodSync(file, 0o644); }
    assert(unsafe.capture('unsafe', false)); assert.equal(fs.readFileSync(target, 'utf8'), 'preserve');
    assert.equal(fs.readFileSync(file, 'utf8'), 'preserve');
  }
  const bounded = harness({ write(ctx) { for (let i = 0; i < 40; i++) ctx.captureInFlight(bounded.home, 'inert-key'); } });
  assert(bounded.capture('event-cap', false)); const capped = bounded.rows()[0];
  assert.equal(capped.events.length, 32); assert(capped.droppedEvents > 0);
  for (let i = 0; i < 200; i++) bounded.capture('event-cap');
  assert(fs.readdirSync(bounded.log).length <= 128);
  for (const name of fs.readdirSync(bounded.log)) {
    const stat = fs.statSync(path.join(bounded.log, name)); assert(stat.size <= 16384); assert.equal(stat.mode & 0o077, 0);
  }
  if (process.platform !== 'win32') for (const mode of ['existing', 'race']) {
    const childRoot = path.join(root, 'fifo-' + mode); fs.mkdirSync(childRoot);
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--fifo', childRoot, mode], { timeout: 5000, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.error?.message); assert(result.stdout.includes('native success unchanged'));
  }
  console.log('Capture timing: exact historical composition, enabled two-slot/pending/ack/native-duplicate evidence, scoped privacy, gate refusal, bounded private ring, disabled/unavailable logging and FIFO races PASS');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
