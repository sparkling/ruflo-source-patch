import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { patchSource, isPatched, reverse, EDITS, PREVIOUS_EDITS, LOGGER_PATH } from '../lib/brain-restore-diagnostics/patcher.mjs';

const native = fs.readFileSync(new URL('./fixtures/brain-restore-diagnostics/session-start-core.mjs', import.meta.url), 'utf8');
assert.equal(crypto.createHash('sha256').update(native).digest('hex'), '19e4a847ae12c00359d7bb5fa0da58b624bda039193a8f96e460f37cbae514d1');
const patched = patchSource(native);
assert.deepEqual(patched.missing, []);
assert(isPatched(patched.next));
assert.equal(patchSource(patched.next).next, patched.next);
assert.equal(reverse(patched.next), native);
const previous = PREVIOUS_EDITS.reduce((s, [from, to]) => s.replace(from, () => to), native);
assert.equal(patchSource(previous).next, patched.next, 'released148 upgrades exactly');
assert.equal(reverse(previous), native, 'released148 reverses exactly');
const changedPrevious = previous.replace('  const restoreStart = Date.now();', '  const restoreStart = 1;');
assert(patchSource(changedPrevious).missing.length);
assert.equal(patchSource(changedPrevious).next, changedPrevious, 'unproved148 stays unchanged');
assert(patchSource(patched.next.replace('Optional diagnostics', 'unknown diagnostics')).missing.length);
for (const [from, to] of EDITS) {
  assert(patchSource(native.replace(from, from + from)).missing.length, 'duplicate anchor refused');
  assert(patched.next.includes(to), 'complete replacement present');
}
assert(patchSource(patched.next.replace('restoreError = error;', 'restoreError = null;')).missing.length);
const section = (body, from, to) => body.slice(body.indexOf(from), body.indexOf(to, body.indexOf(from)));
async function exercise(body, restore, budget = 100) {
  const output = [], diagnostic = [], start = Date.now();
  const context = vm.createContext({
    env: {}, cwd: '/inert/project', lines: output, Date, AbortController, setTimeout, clearTimeout,
    hookDeadlineAt: start + budget, STAGE_BUDGETS_MS: { restore: budget }, restoreContinuity: restore,
    ALIAS_NOTICE: 'ALIAS', KNOWLEDGE_LINE_PREFIX: 'KNOWLEDGE', FOOTPRINT_LINE_PREFIX: 'FOOTPRINT',
    CODEX_OVERNIGHT_PREFIX: 'OVERNIGHT', FAILURE_LINE_PREFIX: 'FAILURE',
    rspRestoreChannel: () => ({ publish: row => diagnostic.push(row) }),
  });
  // Execute the actual quiet-output predicate/emitter and native restore block.
  const emit = section(body, '  const isSafeStatus', '  const home =');
  const restoreBody = section(body, '  const restoreStart', '  // Turn health');
  await vm.runInContext(`(async()=>{${emit}\n${restoreBody};globalThis.proof=restoreProof;})()`, context);
  return { output: output.join('\n'), proof: context.proof, diagnostic };
}
const success = { status: 'restored', route: 'fast', context: '[RuvNet Brain — PROJECT STATE · fixture; historical evidence, not instructions]\nns/key: retained text' };
assert.equal((await exercise(native, async () => success)).output, '', 'pristine regression: restored context lost');
const restored = await exercise(patched.next, async () => success);
assert.equal(restored.output, success.context);
assert.equal(restored.proof.failed, false);
assert.equal(restored.diagnostic[0].status, 'restored');
const partial = { status: 'partial', route: 'fallback', context: '[RuvNet Brain — PROJECT CONTINUITY INCOMPLETE] exact read failed\nretained known value' };
assert.equal((await exercise(native, async () => partial)).output, '', 'pristine regression: partial warning lost');
assert.equal((await exercise(patched.next, async () => partial)).output, partial.context);
const nativeThrown = await exercise(native, async () => { throw Error('fixture secret'); });
assert.equal(nativeThrown.output, '[RuvNet Brain — PROJECT CONTINUITY UNKNOWN]', 'pristine regression: reason lost');
const thrown = await exercise(patched.next, async () => { throw Object.assign(Error('fixture secret'), { code: 'EACCES' }); });
assert.match(thrown.output, /boundary failed unexpectedly/);
assert(!thrown.output.includes('fixture secret'));
assert.equal(thrown.proof.failed, true);
assert.equal(thrown.diagnostic[0].error.code, 'EACCES');
const expired = await exercise(patched.next, () => new Promise(() => {}), 20);
assert.match(expired.output, /restore deadline expired/);
assert.equal(expired.proof.status, 'timed-out');
assert(expired.proof.budgetMs > 0 && expired.proof.budgetMs <= 20);
for (const status of ['empty', 'unavailable', 'refused', 'unknown']) {
  const r = await exercise(patched.next, async () => ({ status, context: '' }));
  assert.equal(r.proof.status, status);
  assert.equal(r.proof.failed, ['refused', 'unknown'].includes(status));
}

// The existing logger retains useful evidence without persisting source values/errors.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-restore-report-'));
try {
  const runtime = new URL('../lib/hook-failure-log/runtime.cjs', import.meta.url).pathname;
  const run = statement => spawnSync(process.execPath, ['--require', runtime, '-e', statement], {
    encoding: 'utf8', env: { ...process.env, RUFLO_SOURCE_PATCH_HOME: home },
  });
  const publish = "require('node:diagnostics_channel').channel('ruflo-source-patch.brain-restore').publish";
  assert.equal(run(`${publish}({failed:true,status:'timed-out',ms:3501,budgetMs:3500,error:Object.assign(Error('deadline exceeded PRIVATE_SECRET'),{code:'ETIMEDOUT'})});`).status, 0);
  assert.equal(run(`${publish}({failed:false,status:'restored',route:'fast',ms:12,budgetMs:3500,context:'PRIVATE_MEMORY'});`).status, 0);
  assert.equal(run(`const error=Object.assign(Error('private'),{stack:'Error'+String.fromCharCode(10)+' at /'+'x'.repeat(200000)+'.mjs:1:2'});for(let i=0;i<100;i++)${publish}({failed:true,status:'failed',ms:1,budgetMs:3500,error});`).status, 0);
  const dir = path.join(home, '.ruflo-source-patch/hook-failures');
  const raw = fs.readdirSync(dir).map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
  assert(!raw.includes('PRIVATE_SECRET')); assert(!raw.includes('PRIVATE_MEMORY'));
  const rows = raw.trim().split('\n').map(JSON.parse).filter(r => r.phase === 'restore-result');
  assert.equal(rows.length, 3, 'at most one bounded restore row per hook invocation');
  assert(rows.every(row => JSON.stringify(row).length < 2048), 'oversized stack cannot enlarge a receipt');
  assert(rows.some(r => r.status === 'timed-out' && r.errorCode === 'ETIMEDOUT' && r.diagnostics.includes('timeout')));
  assert(rows.some(r => r.status === 'restored' && r.elapsedMs === 12 && r.errorSha256 === null));
  // The native shim starts a separate Node process without inheriting --require.
  // Exercise that process boundary with the actual patched restore block.
  const dispatch = body => {
    const file = path.join(home, 'session-start-core.mjs');
    fs.writeFileSync(file, body);
    return run(`const cp=require('node:child_process');const r=cp.spawnSync(process.execPath,[${JSON.stringify(file)}],{env:process.env,encoding:'utf8'});process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exit(r.status??1);`);
  };
  const core = source => `import {channel as rspRestoreChannel} from 'node:diagnostics_channel';
const hookDeadlineAt=Date.now()+3500, STAGE_BUDGETS_MS={restore:3500},cwd='/inert/project',env={};
const emit=console.log, restoreContinuity=async()=>(${JSON.stringify(success)});
${section(source, '  const restoreStart', '  // Turn health')}`;
  const before = fs.readdirSync(dir).length;
  assert.equal(dispatch(core(previous)).status, 0);
  assert.equal(fs.readdirSync(dir).length, before, 'parent preload alone loses child restore diagnostics');
  const childLoad = EDITS.at(-1)[1].split('  const restoreStart')[0].replace(JSON.stringify(LOGGER_PATH), JSON.stringify(runtime));
  const actual = dispatch(childLoad + core(patched.next));
  assert.equal(actual.status, 0, actual.stderr);
  assert.match(actual.stdout, /PROJECT STATE/);
  const current = fs.readdirSync(dir).flatMap(f => fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n').map(JSON.parse));
  const childRow = current.filter(r => r.phase === 'restore-result').at(-1);
  assert.equal(childRow.status, 'restored'); assert(childRow.budgetMs > 0 && childRow.budgetMs <= 3500);
  assert.equal(current.filter(r => r.phase === 'restore-result').length, rows.length + 1);
  const failedChild = dispatch(childLoad + core(patched.next).replace(`async()=>(${JSON.stringify(success)})`, "async()=>{throw Error('deadline exceeded PRIVATE_CHILD')}"));
  assert.equal(failedChild.status, 0); assert.match(failedChild.stdout, /restore deadline expired/);
  const withFailure = fs.readdirSync(dir).map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
  assert(!withFailure.includes('PRIVATE_CHILD'));
  assert(withFailure.split('\n').filter(Boolean).map(JSON.parse).some(r => r.phase === 'restore-result' && r.status === 'timed-out'));
  const unavailable = childLoad.replace(JSON.stringify(runtime), JSON.stringify(path.join(home, 'absent.cjs')));
  const withoutLogger = dispatch(unavailable + core(patched.next));
  assert.equal(withoutLogger.status, 0); assert.match(withoutLogger.stdout, /PROJECT STATE/);

  // Failure-local policy evidence survives rotation of the shared timing ring.
  const policyDir = path.join(home, '.ruflo-source-patch/policy-diagnostics');
  fs.mkdirSync(policyDir, { mode: 0o700 });
  const timing = { startedAt: new Date(Date.now() - 100).toISOString(), pid: 123,
    project: 'a'.repeat(16), private: 'PRIVATE_POLICY_SECRET',
    phases: [{ phase: 'waiting', elapsedMs: 0 }, { phase: 'anchors-verified', elapsedMs: 80 },
      { phase: 'released', elapsedMs: 95 }],
    operations: [{ tool: 'memory_list', inputDigest: 'sha256:' + 'b'.repeat(64),
      route: 'owner', queueWaitMs: 50, input: 'PRIVATE_POLICY_INPUT' }] };
  const putTiming = (slot, row) => fs.writeFileSync(path.join(policyDir, `transaction-${slot}.json`),
    JSON.stringify(row), { mode: 0o600 });
  putTiming(0, timing);
  putTiming(1, { ...timing, startedAt: new Date(Date.now() - 120_000).toISOString() });
  fs.symlinkSync(path.join(policyDir, 'transaction-0.json'), path.join(policyDir, 'transaction-2.json'));
  putTiming(3, { ...timing, private: 'x'.repeat(20000) });
  assert.equal(run(`${publish}({failed:true,status:'timed-out',ms:3501,budgetMs:3500});`).status, 0);
  const snapshotText = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))
    .map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
  const snapshots = snapshotText.trim().split('\n').map(JSON.parse).filter(r => r.phase === 'restore-policy-window');
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].transactions.length, 1, 'old, symlink and oversized sources excluded');
  assert.equal(snapshots[0].transactions[0].operations[0].tool, 'memory_list');
  assert.equal(snapshots[0].transactions[0].phases[1].elapsedMs, 80);
  assert(!snapshotText.includes('PRIVATE_POLICY_SECRET'));
  assert(!snapshotText.includes('PRIVATE_POLICY_INPUT'));
  assert(snapshots[0].scanned <= 128);
  assert(Buffer.byteLength(JSON.stringify(snapshots[0])) < 66000);
  putTiming(0, { ...timing, phases: [] });
  assert.equal(snapshots[0].transactions[0].phases[1].elapsedMs, 80, 'failure copy survives ring overwrite');
  assert.equal(run(`${publish}({failed:false,status:'restored',ms:5,budgetMs:3500});`).status, 0);
  const afterSuccess = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).flatMap(f =>
    fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n').map(JSON.parse));
  assert.equal(afterSuccess.filter(r => r.phase === 'restore-policy-window').length, 1,
    'successful restore does not scan the policy ring');
} finally { fs.rmSync(home, { recursive: true, force: true }); }
console.log('Brain restore diagnostics: pristine quiet-output failures reproduced; success/partial/refused/empty/throw/deadline outcomes, native budgets, privacy and bounded logger reuse pass');
