import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { patchSource, reverseSource, historicalPatchSource, isPatched } from '../lib/brain-capture-launch/patcher.mjs';
import { WAIT_EDITS, undoWait } from '../lib/brain-capture-launch/backpressure.mjs';
import { undoSteps } from '../lib/brain-capture-launch/step-timing.mjs';
import { patchSource as diagnose } from '../lib/brain-capture-diagnostics/patcher.mjs';
import { composeSource } from '../lib/plugin-compose.mjs';

const self = fileURLToPath(import.meta.url);
const native = fs.readFileSync(new URL('./fixtures/brain-learning-receipts/native-4.7.28.mjs', import.meta.url), 'utf8');
const candidate = patchSource(native); assert.deepEqual(candidate.missing, []);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const keyOf = ({ session = '', tool, action }) => 'workflow-' + sha(JSON.stringify([String(session), tool, action]));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function sandbox(cfg) {
  const started = process.uptime(); // Each sandbox represents a fresh native hook process.
  const env = { ...process.env, RUFLO_SOURCE_PATCH_HOME: cfg.home, RUVNET_BRAIN_HOME: cfg.home };
  const failures = [];
  const record = value => fs.appendFileSync(path.join(cfg.home, 'events.jsonl'), JSON.stringify(value) + '\n', { mode: 0o600 });
  const ctx = vm.createContext({ fs, os, path, Date, process: { ...process, env, uptime: () => process.uptime() - started },
    randomUUID: crypto.randomUUID, captureTimingHash: crypto.createHash, observationKey: keyOf,
    learningContext: () => ({ enabled: !fs.existsSync(path.join(cfg.home, 'disabled')), scope: 'project', projectDir: cfg.home, home: cfg.home }),
    resolveRuflo: () => '/inert/ruflo', distillObservations() { throw Error('unexpected distillation'); },
    recordHookFailure: row => { failures.push(row); record({ kind: 'failure', pid: process.pid, error: row.error }); },
    recordLearningObservation(_binary, _context, observation) {
      _context.diagnosticStep?.({ sequence: 0, operation: 'retrieve', durationMs: 1, status: 0, exactMatch: true });
      const key = keyOf(observation); record({ kind: 'start', pid: process.pid, key });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, cfg.delay ?? 120);
      if (cfg.behavior === 'crash') process.exit(7);
      if (cfg.behavior === 'fail' || cfg.behavior === 'timeout') {
        record({ kind: 'end', pid: process.pid, key, failed: true });
        throw Object.assign(Error('native test refusal'), { code: cfg.behavior === 'timeout' ? 'ETIMEDOUT' : 'EIO' });
      }
      fs.writeFileSync(path.join(cfg.home, key + '.exact'), JSON.stringify(observation), { flag: 'wx', mode: 0o600 });
      record({ kind: 'end', pid: process.pid, key, cpu: process.cpuUsage(), maxRss: process.resourceUsage().maxRSS });
      return { exactCli: true, key, db: '/inert/test-store' };
    },
    spawn: (_exe, argv, options) => {
      assert.equal(argv[1], '--observe'); // Only native capture; never replay original tool command.
      return spawn(process.execPath, [self, '--observe', JSON.stringify(cfg)], options);
    },
  });
  vm.runInContext(candidate.next.slice(candidate.next.indexOf('// LOAD BOUNDS'), candidate.next.indexOf('\nconst isMain ='))
    .replace(/\bexport /g, '').replace('fileURLToPath(import.meta.url)', "'/inert/capture.mjs'"), ctx);
  const capture = session => ctx.captureLearning({ hook_event_name: 'PostToolUse', tool_name: 'Bash',
    tool_input: { command: 'git status never-reexecute-private-command' }, session_id: session, cwd: cfg.home }, { brainHome: cfg.home, detach: true });
  return { ctx, env, failures, capture };
}
if (['--parent', '--observe', '--publication-crash'].includes(process.argv[2])) {
  const cfg = JSON.parse(process.argv[3]), h = sandbox(cfg);
  if (process.argv[2] === '--publication-crash') {
    let stagedFd;
    h.ctx.fs = { ...fs,
      openSync(file, ...args) { const fd = fs.openSync(file, ...args); if (String(file).endsWith('.json.staged')) stagedFd = fd; return fd; },
      writeFileSync(file, ...args) {
        if (cfg.phase === 'partial' && file === stagedFd) { fs.writeSync(file, '{'); process.exit(77); }
        return fs.writeFileSync(file, ...args);
      },
      linkSync(from, to) { fs.linkSync(from, to); if (cfg.phase === 'linked' && String(to).endsWith('waiter-0.json')) process.exit(78); },
    };
    h.ctx.withCaptureGate(cfg.home, () => h.ctx.captureWaitClaim(cfg.home, {
      pid: process.pid, start: h.ctx.captureProcessStart(process.pid), token: crypto.randomUUID(), at: Date.now(),
    }));
    throw Error('publication crash seam was not reached');
  } else if (process.argv[2] === '--observe') h.ctx.runDetached('--observe');
  else {
    const started = Date.now(), returned = h.capture(cfg.session);
    console.log(JSON.stringify({ returned, elapsedMs: Date.now() - started, failures: h.failures,
      cpu: process.cpuUsage(), maxRss: process.resourceUsage().maxRSS }));
  }
} else {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-capture-backpressure-'));
  const owned = [], proof = []; let ordinal = 0;
  const home = () => { const p = path.join(root, String(ordinal++)); fs.mkdirSync(p, { mode: 0o700 }); return p; };
  const events = dir => { try { return fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } };
  const waiters = dir => { try { return fs.readdirSync(path.join(dir, 'learn-capture/waiters')).filter(n => /^waiter-\d+\.json$/.test(n)); } catch { return []; } };
  const slots = dir => { try { return fs.readdirSync(path.join(dir, 'learn-capture/slots')); } catch { return []; } };
  const until = async (fn, timeout = 6000) => { const end = Date.now() + timeout; while (!fn()) { assert(Date.now() < end, 'bounded condition timed out'); await sleep(10); } };
  function parent(cfg) {
    const child = spawn(process.execPath, [self, '--parent', JSON.stringify(cfg)], { stdio: ['ignore', 'pipe', 'pipe'] });
    owned.push(child); let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    const result = new Promise((resolve, reject) => child.on('exit', (code, signal) => {
      if (signal) resolve({ killed: signal });
      else if (code !== 0) reject(Error(stderr || 'parent failed ' + code));
      else { try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); } }
    }));
    return { child, result };
  }
  function occupy(dir) {
    const h = sandbox({ home: dir });
    const held = [h.ctx.captureAdmit(dir, 'occupied-a'), h.ctx.captureAdmit(dir, 'occupied-b')];
    return { h, release() { for (const row of held) h.ctx.releaseObserveSlot(row.slot, process.pid, row.token, dir); } };
  }
  try {
    const released = undoWait(undoSteps(candidate.next));
    assert.equal(sha(diagnose(released).next), '9eda5dd3e151e85e871641fba254856cf161a0ef45e46baa5b910f971c7dd863');
    assert.equal(historicalPatchSource(native, released).next, released);
    assert.equal(patchSource(released).next, candidate.next);
    assert.equal(reverseSource(candidate.next), native); assert.equal(reverseSource(released), native);
    assert.equal(composeSource(diagnose(released).next, ['brain-capture-launch', 'brain-capture-diagnostics']), diagnose(candidate.next).next);
    assert.equal(patchSource(diagnose(native).next).next, diagnose(candidate.next).next);
    assert.equal(spawnSync(process.execPath, ['--input-type=module', '--check'], { input: candidate.next }).status, 0);
    for (const [, , to] of WAIT_EDITS) {
      const changed = candidate.next.replace(to, '// unknown edit'); assert.notEqual(changed, candidate.next);
      assert(!isPatched(changed)); assert(patchSource(changed).missing.length); assert.equal(reverseSource(changed), changed);
    }

    // Two occupied native slots, eight distinct live callers: none is acknowledged while waiting.
    for (const duplicate of [false, true]) {
      const dir = home(), initial = occupy(dir), count = duplicate ? 6 : 8;
      const jobs = Array.from({ length: count }, (_, i) => parent({ home: dir, session: duplicate ? 'same-key' : 'distinct-' + i }));
      try { await until(() => waiters(dir).length === count); }
      catch (error) {
        const exited = await Promise.all(jobs.map(async job => job.child.exitCode !== null || job.child.signalCode !== null ? job.result : { pending: true }));
        throw Error(JSON.stringify({ error: error.message, stage: 'waiting-before-release', exited, events: events(dir), waiterCount: waiters(dir).length }));
      }
      assert.equal(events(dir).filter(e => e.kind === 'start').length, 0);
      for (const name of waiters(dir)) {
        const file = path.join(dir, 'learn-capture/waiters', name), bytes = fs.readFileSync(file, 'utf8');
        assert(fs.statSync(file).size < 4096); assert.equal(fs.statSync(file).mode & 0o077, 0);
        assert.deepEqual(Object.keys(JSON.parse(bytes)).sort(), ['at', 'pid', 'start', 'token']);
        assert(!bytes.includes('distinct-') && !bytes.includes('same-key') && !bytes.includes('private-command'));
      }
      initial.release();
      const results = await Promise.all(jobs.map(job => job.result));
      assert(results.every(row => row.returned === true), JSON.stringify({ case: duplicate ? 'duplicate' : 'distinct', results, events: events(dir) }));
      const expected = duplicate ? 1 : count;
      await until(() => events(dir).filter(e => e.kind === 'end').length === expected && slots(dir).length === 0);
      const rows = events(dir); let active = 0, maximum = 0;
      for (const row of rows) { if (row.kind === 'start') maximum = Math.max(maximum, ++active); if (row.kind === 'end') active--; }
      assert(maximum <= 2); assert.equal(rows.filter(e => e.kind === 'start').length, expected);
      assert.equal(new Set(rows.filter(e => e.kind === 'end').map(e => e.key)).size, expected);
      assert.equal(waiters(dir).length, 0); assert(rows.every(e => e.kind !== 'failure'));
      const diagnosticDir = path.join(dir, '.ruflo-source-patch/capture-diagnostics');
      await until(() => {
        try { return fs.readdirSync(diagnosticDir).some(name => {
          const receipt = JSON.parse(fs.readFileSync(path.join(diagnosticDir, name), 'utf8'));
          return receipt.mode === 'child' && receipt.events.some(e => e.phase === 'native-step' && e.exactMatch === true);
        }); } catch { return false; }
      });
      proof.push({ case: duplicate ? 'coalesced-duplicate' : 'occupied-distinct-burst', callers: count, exactWrites: expected,
        maximumAuthorizedWrites: maximum, parentResults: results });
    }

    // Bounded refusal is explicit, and timed-out/failed writes are never retried by admission.
    for (const behavior of ['fail', 'timeout']) {
      const dir = home(), job = parent({ home: dir, session: behavior, behavior });
      assert.equal((await job.result).returned, true); // admitted only, not a persistence receipt
      await until(() => events(dir).some(e => e.kind === 'failure') && slots(dir).length === 0);
      assert.equal(events(dir).filter(e => e.kind === 'start').length, 1);
      assert.equal(fs.readdirSync(dir).filter(n => n.endsWith('.exact')).length, 0);
      assert(!fs.readdirSync(path.join(dir, 'learn-capture/recent')).some(n => !n.endsWith('.pending')));
    }

    const uncertain = home(), crashed = parent({ home: uncertain, session: 'unknown-write', behavior: 'crash' });
    assert.equal((await crashed.result).returned, true);
    await until(() => events(uncertain).some(e => e.kind === 'start'));
    const writerPid = events(uncertain).find(e => e.kind === 'start').pid;
    await until(() => { try { process.kill(writerPid, 0); return false; } catch (e) { return e.code === 'ESRCH'; } });
    const repeat = await parent({ home: uncertain, session: 'unknown-write' }).result;
    assert.equal(repeat.returned, true); // Native pending coalescence, still NOT an exact acknowledgement.
    assert.equal(events(uncertain).filter(e => e.kind === 'start').length, 1, 'never retry an unknown write');
    assert(!fs.readdirSync(path.join(uncertain, 'learn-capture/recent')).some(n => !n.endsWith('.pending')));
    assert.equal((await parent({ home: uncertain, session: 'new-after-crash' }).result).returned, true);
    await until(() => events(uncertain).filter(e => e.kind === 'end').length === 1 && slots(uncertain).length === 0);

    const full = home(), held = occupy(full), directory = path.join(full, 'learn-capture/waiters');
    fs.mkdirSync(directory, { mode: 0o700 });
    for (let i = 0; i < 8; i++) fs.writeFileSync(path.join(directory, 'waiter-' + i + '.json'), JSON.stringify({ pid: process.pid, start: null, token: crypto.randomUUID(), at: Date.now() }), { mode: 0o600 });
    const limited = await parent({ home: full, session: 'overload' }).result;
    assert.equal(limited.returned, false); assert(limited.failures.some(e => e.error === 'capture admission wait capacity exhausted'));
    assert(limited.elapsedMs < 1000); assert.equal(waiters(full).length, 8); held.release();

    const crash = home(), occupied = occupy(crash), killed = parent({ home: crash, session: 'killed-before-admission' });
    await until(() => waiters(crash).length === 1); killed.child.kill('SIGKILL'); await killed.result;
    const successor = parent({ home: crash, session: 'survivor' });
    await until(() => waiters(crash).length === 1 && JSON.parse(fs.readFileSync(path.join(crash, 'learn-capture/waiters', waiters(crash)[0]))).pid === successor.child.pid);
    occupied.release(); assert.equal((await successor.result).returned, true);
    await until(() => events(crash).filter(e => e.kind === 'end').length === 1 && slots(crash).length === 0);
    assert.equal(events(crash).filter(e => e.kind === 'start').length, 1); assert.equal(waiters(crash).length, 0);

    const denied = home(), busy = occupy(denied), changing = parent({ home: denied, session: 'revoked' });
    await until(() => waiters(denied).length === 1); fs.writeFileSync(path.join(denied, 'disabled'), '');
    const refused = await changing.result; assert.equal(refused.returned, false);
    assert(refused.failures.some(e => e.error === 'capture admission consent changed')); assert.equal(waiters(denied).length, 0); busy.release();

    const deadline = home(), budget = occupy(deadline), began = Date.now();
    assert.throws(() => budget.h.ctx.captureWaitAdmit(deadline, 'deadline', { deadlineAt: Date.now() + 400 }), /wait expired/);
    assert(Date.now() - began < 600); assert.equal(waiters(deadline).length, 0); budget.release();
    const oldUptime = budget.h.ctx.process.uptime;
    budget.h.ctx.process.uptime = () => 20; assert(budget.h.ctx.captureWaitDeadline({}) <= Date.now());
    budget.h.ctx.process.uptime = () => 0.5;
    for (const handed of [2200, 4000]) {
      const before = Date.now(), end = budget.h.ctx.captureWaitDeadline({ RUVNET_CODEX_BUDGET_MS: String(handed) });
      assert(end <= Date.now() + handed - 800 && end >= before + handed - 800);
    }
    let expiredDispatches = 0; const nativeAdmit = budget.h.ctx.captureAdmit;
    budget.h.ctx.captureAdmit = (...args) => { expiredDispatches++; return nativeAdmit(...args); };
    assert.throws(() => budget.h.ctx.captureWaitAdmit(deadline, 'expired-before-dispatch', { env: { RUVNET_CODEX_BUDGET_MS: '100' } }), /wait expired/);
    assert.equal(expiredDispatches, 0); budget.h.ctx.captureAdmit = nativeAdmit;
    budget.h.ctx.process.uptime = oldUptime;
    assert(budget.h.ctx.captureWaitDeadline({ RUVNET_DECISION_DEADLINE: String(Date.now() + 200) }) <= Date.now() + 200);

    for (const phase of ['partial', 'linked']) {
      const dir = home();
      const killed = spawnSync(process.execPath, [self, '--publication-crash', JSON.stringify({ home: dir, phase })], { timeout: 2000, encoding: 'utf8' });
      assert.equal(killed.status, phase === 'partial' ? 77 : 78, killed.stderr);
      const staged = path.join(dir, 'learn-capture/waiters/waiter-0.json.staged'), published = staged.slice(0, -7);
      if (phase === 'partial') { assert.equal(fs.readFileSync(staged, 'utf8'), '{'); assert(!fs.existsSync(published)); }
      else { assert.equal(fs.statSync(staged).nlink, 2); assert.equal(fs.statSync(published).ino, fs.statSync(staged).ino); }
      assert.equal((await parent({ home: dir, session: 'after-publication-crash' }).result).returned, true);
      await until(() => events(dir).filter(e => e.kind === 'end').length === 1 && slots(dir).length === 0);
      assert(!fs.existsSync(staged)); assert.equal(waiters(dir).length, 0);
    }

    // Reproduce ENOENT between complete gate observation and the subsequent exists check.
    const replaced = home(), raced = sandbox({ home: replaced }), gate = path.join(replaced, 'learn-capture/admission.lock');
    fs.mkdirSync(gate, { recursive: true });
    const dead = spawnSync(process.execPath, ['-e', "if(process.platform==='linux')process.stdout.write(require('node:fs').readFileSync('/proc/self/stat','utf8').split(') ').at(-1).split(' ')[19]);"], { encoding: 'utf8' });
    assert.equal(dead.status, 0, dead.stderr);
    fs.writeFileSync(path.join(gate, 'owner.json'), JSON.stringify({ pid: dead.pid, start: dead.stdout || null, token: crypto.randomUUID() }));
    let injected = false;
    raced.ctx.fs = { ...fs, readFileSync(file, ...args) {
      if (!injected && file === path.join(gate, 'owner.json')) { injected = true; throw Object.assign(Error('fixture concurrent replacement'), { code: 'ENOENT' }); }
      return fs.readFileSync(file, ...args);
    } };
    assert.equal(raced.capture('gate-replacement'), true, JSON.stringify(raced.failures)); assert(injected);
    await until(() => events(replaced).filter(e => e.kind === 'end').length === 1 && slots(replaced).length === 0);

    for (const kind of ['unknown', 'symlink', 'fifo']) {
      if (kind === 'fifo' && process.platform === 'win32') continue;
      const unsafe = home(), fixed = occupy(unsafe), dir = path.join(unsafe, 'learn-capture/waiters');
      fs.mkdirSync(dir, { mode: 0o700 }); const file = path.join(dir, 'waiter-0.json');
      if (kind === 'unknown') fs.writeFileSync(file, '{private-metadata-must-not-leak', { mode: 0o600 });
      if (kind === 'symlink') fs.symlinkSync(path.join(unsafe, 'absent'), file);
      if (kind === 'fifo') assert.equal(spawnSync('mkfifo', ['-m', '600', file]).status, 0);
      const result = spawnSync(process.execPath, [self, '--parent', JSON.stringify({ home: unsafe, session: 'unsafe' })], { timeout: 2000, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr || result.error?.message);
      const row = JSON.parse(result.stdout); assert.equal(row.returned, false); assert.equal(row.failures.length, 1);
      assert(!result.stdout.includes('private-metadata-must-not-leak')); assert(fs.lstatSync(file));
      assert.equal(events(unsafe).filter(e => e.kind === 'start').length, 0); fixed.release();
    }

    console.log('Capture backpressure: exact118 composition, occupied distinct burst, coalescing, two writers/eight waiters, failures, caller crash, consent and host deadline PASS');
    console.log(JSON.stringify({ boundedSyntheticProof: proof }));
  } finally {
    for (const child of owned) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await sleep(150); fs.rmSync(root, { recursive: true, force: true });
  }
}
