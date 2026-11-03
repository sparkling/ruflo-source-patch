// Independent review: real caller processes and inert children; metadata only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fork, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { patchSource } from '../lib/brain-capture-launch/patcher.mjs';
import { patchSource as diagnose } from '../lib/brain-capture-diagnostics/patcher.mjs';

const self = fileURLToPath(import.meta.url), hash = text => crypto.createHash('sha256').update(text).digest('hex');
const native = fs.readFileSync(new URL('./fixtures/brain-learning-receipts/native-4.7.28.mjs', import.meta.url), 'utf8');
// Exact native learning-store observation key; no installed package or database required.
const keyDeclaration = "export const observationKey = ({ session = '', tool, action }) => 'workflow-' + createHash('sha256').update(JSON.stringify([String(session), tool, action])).digest('hex');";
const keyOf = vm.runInNewContext(keyDeclaration.replace('export ', '') + '\nobservationKey', { createHash: crypto.createHash });
const keyFor = session => keyOf({ session, tool: 'Bash', action: 'git status' });

if (process.argv[2] === '--worker') {
  const cfg = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const source = fs.readFileSync(cfg.source, 'utf8');
  let ordinal = 0, paused = false, launches = 0;
  const failures = [];
  const pause = (file, method) => {
    if (cfg.pause?.method !== method || file !== cfg.pause.file || paused || ++ordinal !== cfg.pause.ordinal) return;
    paused = true; process.send({ event: 'paused' });
    const until = Date.now() + 6000;
    while (!fs.existsSync(cfg.resume)) {
      if (Date.now() > until) throw Error('review barrier timed out');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  };
  const facade = { ...fs,
    statSync(file, ...args) { const value = fs.statSync(file, ...args); pause(file, 'statSync'); return value; },
    lstatSync(file, ...args) { const value = fs.lstatSync(file, ...args); pause(file, 'lstatSync'); return value; },
    readFileSync(file, ...args) { const value = fs.readFileSync(file, ...args); pause(file, 'readFileSync'); return value; },
    linkSync(from, to) { fs.linkSync(from, to); pause(to, 'linkSync'); },
  };
  const ctx = vm.createContext({ fs: facade, os, path, Date, process, createHash: crypto.createHash, randomUUID: crypto.randomUUID,
    learningContext: () => ({ enabled: true, scope: 'project' }), resolveRuflo: () => '/inert/ruflo',
    recordLearningObservation: () => { throw Error('database operation forbidden in review'); },
    distillObservations: () => { throw Error('database operation forbidden in review'); },
    recordHookFailure: row => failures.push(row), failureScope: fields => fields, validFailureScope: fields => fields,
    spawn: (_exe, _argv, options) => {
      launches++;
      const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], options);
      process.send({ event: 'inert-child', pid: child.pid });
      return child;
    },
  });
  vm.runInContext(keyDeclaration.replace('export ', ''), ctx);
  vm.runInContext(source.slice(source.indexOf('// LOAD BOUNDS'), source.indexOf('\nconst isMain ='))
    .replace(/\bexport /g, '').replace('fileURLToPath(import.meta.url)', "'/inert/learn-capture.mjs'"), ctx);
  process.on('message', message => {
    try {
      let value;
      if (message.op === 'capture') value = ctx.captureLearning({ hook_event_name: 'PostToolUse', tool_name: 'Bash',
        tool_input: { command: 'git status' }, tool_response: { exit_code: 0 }, session_id: message.session },
      { brainHome: cfg.home, detach: true });
      else if (message.op === 'prune') { ctx.markCaptured(cfg.home, message.key); value = true; }
      else throw Error('unknown review operation');
      process.send({ id: message.id, value, launches, failures });
    } catch (error) { process.send({ id: message.id, error: error.message }); }
  });
  process.send({ event: 'ready' });
} else {
  assert.equal(hash(native), 'cf9fb218c5e51cdb29298801cb5634f864c9bb73b93926afac505624a4fd3edc');
  const fixed = patchSource(native); assert.deepEqual(fixed.missing, []);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-independent-capture-'));
  const rows = [];
  let seq = 0;
  const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const put = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
  try {
    for (const [name, source] of [['ownership-candidate', diagnose(fixed.next).next]]) {
      const sourceFile = path.join(temp, name + '.source'); put(sourceFile, source);
      for (const kind of ['stale-pending', 'stale-slot', 'prune-renewed', 'live-slots-control', 'prune-live-control', 'crashed-reclaimer']) {
        const home = path.join(temp, name, kind), resume = path.join(home, 'resume');
        const marker = path.join(home, 'learn-capture/recent', keyFor('same') + '.pending');
        const slot = path.join(home, 'learn-capture/slots/slot-0');
        const workers = [], inert = [];
        let requestId = 0;
        async function worker(pause) {
          const cfg = path.join(home, 'caller-' + seq++ + '.json'); put(cfg, JSON.stringify({ source: sourceFile, home, resume, pause }));
          const child = fork(self, ['--worker', cfg], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
          workers.push(child);
          let readyResolve, pausedResolve, errorText = '';
          const pending = new Map();
          const ready = new Promise(resolve => { readyResolve = resolve; });
          const paused = new Promise(resolve => { pausedResolve = resolve; });
          child.stderr.on('data', chunk => { errorText += chunk; });
          child.on('message', message => {
            if (message.event === 'ready') readyResolve();
            if (message.event === 'paused') pausedResolve();
            if (message.event === 'inert-child') inert.push(message.pid);
            if (message.id && pending.has(message.id)) {
              const { resolve, reject, timer } = pending.get(message.id); clearTimeout(timer); pending.delete(message.id);
              message.error ? reject(Error(message.error)) : resolve(message);
            }
          });
          child.on('exit', (code, signal) => { if (code || signal) for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(Error(errorText || 'caller exited')); } });
          await Promise.race([ready, new Promise((_, reject) => { const t = setTimeout(() => reject(Error('caller not ready')), 6000); t.unref(); })]);
          return { paused, run(op, fields) { return new Promise((resolve, reject) => {
            const id = ++requestId, timer = setTimeout(() => reject(Error('operation timed out')), 7000);
            pending.set(id, { resolve, reject, timer }); child.send({ id, op, ...fields });
          }); } };
        }
        try {
          if (kind === 'crashed-reclaimer') {
            const reaped = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
            const deadPid = reaped.pid; await new Promise(resolve => reaped.once('close', resolve));
            const gateDir = path.join(home, 'learn-capture', 'admission.lock');
            put(path.join(gateDir, 'owner.json'), JSON.stringify({ pid: deadPid, start: null, token: crypto.randomUUID() }));
            const a = await worker({ method: 'linkSync', file: path.join(gateDir, 'claim-0.json'), ordinal: 1 });
            const interrupted = a.run('capture', { session: 'interrupted' }).catch(() => null);
            await a.paused;
            assert.equal(JSON.parse(fs.readFileSync(path.join(gateDir, 'claim-0.json'))).pid, workers[0].pid, 'public claim is already complete');
            await new Promise(resolve => { workers[0].once('close', resolve); workers[0].kill('SIGTERM'); });
            await interrupted;
            const b = await worker(); assert.equal((await b.run('capture', { session: 'recovered' })).value, true);
            assert.equal(inert.length, 1); assert(!fs.existsSync(gateDir));
            rows.push({ source: name, case: kind, recoveredAfterActualReclaimerDeath: true });
            continue;
          }
          if (kind === 'live-slots-control') {
            const a = await worker(), b = await worker(), c = await worker();
            assert.equal((await a.run('capture', { session: 'a' })).value, true);
            assert.equal((await b.run('capture', { session: 'b' })).value, true);
            const over = await c.run('capture', { session: 'c' });
            assert.equal(over.value, false); assert.equal(inert.length, 2); assert(inert.every(alive));
            assert.equal(over.failures.at(-1).error, 'shed observation (load)');
            rows.push({ source: name, case: kind, liveInertDetachedChildren: 2, thirdDistinctShed: true });
            continue;
          }
          if (kind === 'prune-live-control') {
            for (let i = 0; i < 256; i++) put(path.join(path.dirname(marker), keyFor('prior-' + i)), '');
            const a = await worker(), b = await worker(), c = await worker();
            assert.equal((await b.run('capture', { session: 'same' })).value, true);
            await a.run('prune', { key: keyFor('another-ack') });
            assert(fs.existsSync(marker));
            assert.equal((await c.run('capture', { session: 'same' })).value, true);
            assert.equal(inert.length, 1); assert(inert.every(alive));
            rows.push({ source: name, case: kind, freshPendingRetained: true, sameKeyCoalesced: true });
            continue;
          }
          let pause;
          if (kind === 'stale-slot') {
            // Obtain a real reaped PID; no invented liveness result.
            const dead = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
            const deadPid = dead.pid; await new Promise(resolve => dead.once('close', resolve)); assert(!alive(deadPid));
            put(slot, JSON.stringify({ pid: deadPid, at: Date.now() }));
            pause = { method: 'readFileSync', file: slot, ordinal: 1 };
          } else {
            put(marker, ''); const old = new Date(Date.now() - (kind === 'prune-renewed' ? 601000 : 61000)); fs.utimesSync(marker, old, old);
            pause = { method: 'lstatSync', file: marker, ordinal: kind === 'stale-pending' && name !== 'pristine' ? 2 : 1 };
            if (kind === 'prune-renewed') for (let i = 0; i < 256; i++) put(path.join(path.dirname(marker), keyFor('prior-' + i)), '');
          }
          const a = await worker(pause), b = await worker();
          const outer = kind === 'prune-renewed' ? a.run('prune', { key: keyFor('another-ack') }) : a.run('capture', { session: kind === 'stale-slot' ? 'a' : 'same' });
          await a.paused;
          const inner = await b.run('capture', { session: kind === 'stale-slot' ? 'b' : 'same' });
          assert.equal(inner.value, false); assert.equal(inner.launches, 0);
          assert.equal(inner.failures.at(-1).error, 'capture admission contended');
          put(resume, 'resume'); const outerResult = await outer; assert.equal(outerResult.value, true);
          const c = await worker();
          if (kind === 'stale-slot' || kind === 'stale-pending') {
            assert.equal((await c.run('capture', { session: 'distinct' })).value, true);
            assert.equal(inert.length, 2); assert(inert.every(alive));
            assert.equal(fs.readdirSync(path.dirname(slot)).length, 2);
            rows.push({ source: name, case: kind, liveInertDetachedChildren: 2, blockedContender: true, distinctAdmittedAfterGateRelease: true });
          } else {
            assert.equal(fs.existsSync(marker), false, 'pruned marker was never renewed by refused contender');
            assert.equal((await c.run('capture', { session: 'same' })).value, true);
            assert.equal(inert.length, 1); assert(inert.every(alive));
            await a.run('prune', { key: keyFor('yet-another-ack') });
            assert(fs.existsSync(marker), 'new fresh pending retained on next pruning pass');
            rows.push({ source: name, case: kind, liveInertDetachedChildren: 1, blockedContender: true, freshPendingRetained: true });
          }
        } finally {
          for (const pid of inert) { try { process.kill(-pid, 'SIGTERM'); } catch {} }
          await Promise.all(workers.map(child => new Promise(resolve => { if (child.exitCode !== null || child.signalCode !== null) return resolve(); child.once('close', resolve); child.kill('SIGTERM'); }))); 
        }
      }
    }
    assert.equal(rows.length, 6);
    console.log('Capture ownership: three real-process races, live/coalescing controls and interrupted reclaimer recovery PASS');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
