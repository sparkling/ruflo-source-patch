import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { HANDOFF_HELPER } from '../lib/brain-capture-idempotency/handoff.mjs';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-turn-handoff-'));
const receipts = path.join(root, 'turn-capture/receipts.jsonl');
const worker = path.join(root, 'worker.mjs');
const failures = [], children = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const rows = () => fs.existsSync(receipts) ? fs.readFileSync(receipts, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const shared = `const RUFLO_ENV={};const flagValue=(args,flag)=>args[args.indexOf(flag)+1];
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');const redactText=x=>x;
const appendReceipt=(file,row)=>{fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.appendFileSync(file,JSON.stringify(row)+'\\n');};
const failureScope=()=>({}),validFailureScope=()=>({});`;
fs.writeFileSync(worker, `import fs from'node:fs';import os from'node:os';import path from'node:path';import crypto from'node:crypto';import{spawn}from'node:child_process';import{fileURLToPath}from'node:url';
${shared}
const recordHookFailure=()=>{};
const readStdinBounded=async()=>fs.readFileSync(0);
const runSteps=(job,options)=>{
 if(options.deadlineMs!==job.deadlineMs||options.projectDir!==job.projectDir||options.brainHome!==job.brainHome)throw Error('lost native boundary');
 fs.writeFileSync(job.steps[0].started,'started');
 fs.appendFileSync(${JSON.stringify(path.join(root, 'execution.jsonl'))},JSON.stringify({event:'start',pid:process.pid})+'\\n');
 Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500);
 appendReceipt(job.receipts,{kind:'store',key:flagValue(job.steps[0].args,'--key'),verified:true,status:0,event:job.event});
 fs.appendFileSync(${JSON.stringify(path.join(root, 'execution.jsonl'))},JSON.stringify({event:'end',pid:process.pid})+'\\n');
};
${HANDOFF_HELPER}
try{await runFreshTurn();}catch{process.exitCode=1;}
`);
const context = vm.createContext({ fs, os, path, crypto, process, Buffer, Date, Atomics, Int32Array, SharedArrayBuffer,
  spawn, setTimeout, fileURLToPath: () => worker, recordHookFailure: row => failures.push(row) });
vm.runInContext(shared + HANDOFF_HELPER.replaceAll('import.meta.url', JSON.stringify(pathToFileURL(worker).href)), context);
const launch = (key, event = 'SessionEnd') => {
  const step = { kind: 'store', started: path.join(root, key + '.started'), args: ['memory', 'store', '--key', key,
    '--path', path.join(root, 'inert.db'), '--value', 'PRIVATE_TURN_BODY_NOT_IN_ARGV'] };
  const result = context.launchFreshTurn([step], { receipts, brainHome: root, projectDir: root, event,
    env: process.env, deadlineMs: Date.now() + 3000 });
  children.push(result.pid); return result;
};
try {
  // A gate can disappear during owner observation and be replaced before the
  // existence check. Re-observe within the same deadline; never claim it blind.
  let vanished = false, replacement = false;
  const racedFs = Object.create(fs);
  racedFs.lstatSync = (file, ...args) => {
    if (String(file).endsWith('/admission.lock') && !vanished) {
      vanished = true; throw Object.assign(new Error('released during observation'), { code: 'ENOENT' });
    }
    return fs.lstatSync(file, ...args);
  };
  racedFs.existsSync = file => {
    if (String(file).endsWith('/admission.lock') && vanished && !replacement) { replacement = true; return true; }
    return fs.existsSync(file);
  };
  const raced = vm.createContext({ fs: racedFs, path, crypto, process, Date, Atomics, Int32Array, SharedArrayBuffer });
  vm.runInContext(HANDOFF_HELPER.replaceAll('import.meta.url', JSON.stringify(pathToFileURL(worker).href)), raced);
  assert.equal(raced.withTurnWorkerGate(root, () => 42), 42);
  assert(vanished && replacement);
  for (const deadlineMs of [undefined, null, 'later', NaN]) assert.equal(context.turnAttemptPending({ pending: true, deadlineMs, owner: { pid: process.pid } }), false);
  assert.equal(context.turnAttemptPending({ pending: true, deadlineMs: Date.now() + 1000, owner: { pid: -1 } }), false);
  assert.equal(context.turnAttemptPending({ pending: true, deadlineMs: Date.now() + 1000, owner: { pid: process.pid } }), true);
  const a = launch('one'), b = launch('two', 'PreCompact');
  for (let i = 3; i <= 8; i++) launch('burst-' + i);
  assert.equal(a.pending, true); assert.equal(b.pending, true);
  assert.throws(() => launch('nine'), /pending capacity exhausted before dispatch/);
  assert.equal(rows().filter(x => x.pending).length, 8);
  assert.equal(rows().filter(x => x.verified).length, 0, 'pending never claims persistence');
  const argv = spawnSync('ps', ['-p', String(a.pid), '-o', 'args='], { encoding: 'utf8' }).stdout;
  assert(!argv.includes('PRIVATE_TURN_BODY_NOT_IN_ARGV') && !argv.includes('inert.db'));
  for (const name of fs.readdirSync(path.join(root, 'turn-capture/workers/pending'))) {
    const text = fs.readFileSync(path.join(root, 'turn-capture/workers/pending', name), 'utf8');
    assert(!text.includes('PRIVATE_TURN') && !text.includes('inert.db'));
    assert(Buffer.byteLength(text) < 4096);
  }
  for (let i = 0; i < 160 && rows().filter(x => x.verified).length < 8; i++) await pause(25);
  assert.equal(rows().filter(x => x.verified).length, 8);
  assert.equal(rows().filter(x => x.verified && x.event === 'PreCompact').length, 1);
  let running = 0, peak = 0;
  for (const row of fs.readFileSync(path.join(root, 'execution.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)) {
    running += row.event === 'start' ? 1 : -1; peak = Math.max(peak, running);
  }
  assert.equal(peak, 2); assert.equal(running, 0, 'eight first attempts settle with no increased write concurrency');
  for (let i = 0; i < 40 && fs.readdirSync(path.join(root, 'turn-capture/workers/slots')).length; i++) await pause(25);
  assert.equal(fs.readdirSync(path.join(root, 'turn-capture/workers/slots')).length, 0);
  // A pre-upgrade/live worker still owns an execution slot. New waiters cannot
  // steal it by age or exceed the shared two-write limit.
  const executionDir = path.join(root, 'turn-capture/workers/slots');
  const live = { pid: process.pid, token: crypto.randomUUID() };
  for (let i = 0; i < 2; i++) fs.writeFileSync(path.join(executionDir, 'slot-' + i), JSON.stringify(live));
  const queued = launch('waiting-on-old-workers');
  await pause(150);
  assert(!fs.existsSync(path.join(root, 'waiting-on-old-workers.started')));
  for (let i = 0; i < 2; i++) fs.unlinkSync(path.join(executionDir, 'slot-' + i));
  for (let i = 0; i < 80 && !rows().some(x => x.key === 'waiting-on-old-workers' && x.verified); i++) await pause(25);
  assert(rows().some(x => x.key === 'waiting-on-old-workers' && x.verified));
  // Deadline exhaustion is a pre-dispatch failure, without a store or lease theft.
  await pause(50);
  const ownSlot = path.join(root, 'turn-capture/workers/pending/slot-0');
  const own = { ...live, at: Date.now() };
  fs.writeFileSync(ownSlot, JSON.stringify(own));
  for (let i = 0; i < 2; i++) fs.writeFileSync(path.join(executionDir, 'slot-' + i), JSON.stringify({ ...live, token: crypto.randomUUID() }));
  await assert.rejects(context.turnWaitForExecution({ brainHome: root, slot: ownSlot, token: own.token, deadlineMs: Date.now() + 100 }), /wait expired before dispatch/);
  assert.equal(fs.readdirSync(executionDir).length, 2);
  for (let i = 0; i < 2; i++) fs.unlinkSync(path.join(executionDir, 'slot-' + i));
  fs.unlinkSync(ownSlot);
  const killed = launch('killed', 'Stop');
  for (let i = 0; i < 80 && !fs.existsSync(path.join(root, 'killed.started')); i++) await pause(10);
  assert(fs.existsSync(path.join(root, 'killed.started'))); process.kill(killed.pid, 'SIGKILL');
  await pause(50);
  assert(!rows().some(x => x.key === 'killed' && x.verified), 'killed worker remains unknown');
  launch('fresh-after-dead');
  await pause(700);
  assert.equal(rows().filter(x => x.key === 'killed').length, 1, 'dead lease recovery does not replay payload');
  const slot = path.join(root, 'turn-capture/workers/pending/slot-0');
  fs.writeFileSync(slot, '{}');
  assert.throws(() => launch('unknown'), /owner unknown/);
  console.log('Fresh turn handoff: eight bounded first attempts, two executing workers, stdin-only body, pending receipts, native deadline/context, dead lease recovery, unknown refusal and no replay PASS');
} finally {
  for (const pid of children) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  fs.rmSync(root, { recursive: true, force: true });
}
