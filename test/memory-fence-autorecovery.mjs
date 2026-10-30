import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { MEMORY_LOCK_SOURCE, MEMORY_LOCK_SOURCE_V2 } from '../lib/cwd/memory-lock-source.mjs';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-auto-fence-')));
process.env.RUFLO_SOURCE_PATCH_HOME = root;
const stable = path.join(root, '.ruflo-source-patch/lib');
fs.cpSync(new URL('../lib/', import.meta.url), stable, { recursive: true });
const dead = spawnSync(process.execPath, ['-e', '']).pid;
const worker = path.join(root, 'worker.mjs');
fs.writeFileSync(worker, `import fs from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
const target = process.argv[2], mode = process.argv[3];
const originalOpen = fs.openSync;
fs.openSync = (file, ...args) => {
  if (['', '-wal', '-shm'].some(suffix => String(file) === target + suffix))
    throw new Error('managed sentinel opened');
  return originalOpen(file, ...args);
};
syncBuiltinESMExports();
const native = createRequire(import.meta.url);
const __rufloReq = name => name === 'fs' ? { ...fs, linkSync(from, to) {
  const result = fs.linkSync(from, to);
  if (mode === 'crash' && to === target + '.rsp-lock.recovery') process.kill(process.pid, 'SIGKILL');
  return result;
} } : native(name);
${MEMORY_LOCK_SOURCE}
await __rufloWithLock(target, async () => {
  fs.writeFileSync(target + '.active', String(process.pid), { flag: 'wx' });
  await new Promise(resolve => setTimeout(resolve, 20));
  fs.appendFileSync(target + '.receipts', process.pid + '\\n');
  fs.unlinkSync(target + '.active');
});
`);
function fixture(name, owner = dead) {
  const dir = path.join(root, name); fs.mkdirSync(dir, { mode: 0o700 });
  const db = path.join(dir, 'memory.db'), lock = db + '.rsp-lock', gate = lock + '.recovery';
  for (const suffix of ['', '-wal', '-shm']) fs.writeFileSync(db + suffix, 'untouched sentinel ' + suffix);
  fs.writeFileSync(lock, JSON.stringify({ pid: dead, token: dead + ':writer' }), { mode: 0o600 });
  fs.writeFileSync(gate, JSON.stringify({ schema: 'rsp-memory-recovery-owner/v1',
    pid: owner, token: owner + ':recoverer', lockFile: lock }), { mode: 0o600 });
  return { dir, db, lock, gate };
}
function run(f) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [worker, f.db], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = ''; child.stderr.on('data', bytes => { stderr += bytes; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 12000);
    child.on('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stderr }); });
  });
}
try {
  const { ENTRIES, composeCliContribution, historicalCliContribution } = await import('../lib/cwd/patch-library.mjs');
  const entry = ENTRIES.find(e => e.id === 'memory/write-lock');
  const pristine = '//# sourceMappingURL=memory-initializer.js.map';
  const current = composeCliContribution(pristine, [entry]).next;
  const previous = current.replace(MEMORY_LOCK_SOURCE, MEMORY_LOCK_SOURCE_V2);
  assert.equal(historicalCliContribution(pristine, previous, [entry]).next, previous);
  const unknown = previous.replace('const deadline = Date.now() + 5000;', 'const deadline = Date.now() + 7000;');
  assert.notEqual(historicalCliContribution(pristine, unknown, [entry]).next, unknown);
  assert.ok(!previous.includes(entry.proof));
  const crash = fixture('crash'); fs.unlinkSync(crash.gate);
  const claim = fs.readFileSync(crash.lock, 'utf8');
  const killed = spawnSync(process.execPath, [worker, crash.db, 'crash'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(killed.signal, 'SIGKILL');
  const fence = fs.readFileSync(crash.gate, 'utf8');
  assert.equal(JSON.parse(fence).pid, killed.pid);
  const results = await Promise.all(Array.from({ length: 8 }, () => run(crash)));
  assert.ok(results.every(r => r.code === 0), JSON.stringify(results));
  assert.equal(fs.readFileSync(crash.db + '.receipts', 'utf8').trim().split('\n').length, 8);
  const archives = fs.readdirSync(crash.dir).filter(name => name.includes('.recovery-archive-'));
  assert.equal(archives.length, 1);
  const archive = path.join(crash.dir, archives[0]);
  assert.equal(fs.readFileSync(path.join(archive, 'fence'), 'utf8'), fence);
  const receipt = JSON.parse(fs.readFileSync(path.join(archive, 'result.json')));
  assert.equal(receipt.status, 'fence-archived');
  assert.equal(receipt.databaseOpened, false); assert.equal(receipt.claimModified, false);
  assert.equal(receipt.memoryHealthVerified, false);
  const claims = fs.readdirSync(crash.dir).filter(name => name.includes('.rsp-lock.dead-'));
  assert.equal(claims.length, 1);
  assert.equal(fs.readFileSync(path.join(crash.dir, claims[0]), 'utf8'), claim);
  for (const suffix of ['', '-wal', '-shm']) assert.equal(fs.readFileSync(crash.db + suffix, 'utf8'), 'untouched sentinel ' + suffix);
  assert.equal(fs.existsSync(crash.gate), false); assert.equal(fs.existsSync(crash.lock), false);

  const cases = [fixture('live', process.pid), fixture('malformed'), fixture('symlink'),
    fixture('legacy'), fixture('live-writer'), fixture('missing-helper')];
  fs.writeFileSync(cases[1].gate, '{}');
  fs.renameSync(cases[2].gate, cases[2].gate + '-original'); fs.symlinkSync(cases[2].gate + '-original', cases[2].gate);
  fs.unlinkSync(cases[3].gate); fs.mkdirSync(cases[3].gate, { mode: 0o700 });
  fs.writeFileSync(cases[4].lock, JSON.stringify({ pid: process.pid, token: process.pid + ':live' }));
  const before = cases.map(f => fs.lstatSync(f.gate).ino);
  const refused = await Promise.all(cases.slice(0, -1).map(run));
  for (const result of refused) {
    assert.notEqual(result.code, 0); assert.equal(result.signal, null);
    assert.match(result.stderr, /RSP_MEMORY_LOCK_UNAVAILABLE/);
  }
  fs.renameSync(path.join(stable, 'cwd/memory-fence-recovery.mjs'), path.join(stable, 'cwd/memory-fence-recovery.disabled'));
  assert.notEqual((await run(cases.at(-1))).code, 0);
  cases.forEach((f, i) => {
    assert.equal(fs.lstatSync(f.gate).ino, before[i]);
    assert.equal(fs.existsSync(f.db + '.receipts'), false);
  });
  console.log('memory-fence-autorecovery: SIGKILL, 8 competing callers, durable evidence, and 6 refusal boundaries passed');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
