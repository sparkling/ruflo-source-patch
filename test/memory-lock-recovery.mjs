import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { MEMORY_LOCK_SOURCE } from '../lib/cwd/memory-lock-source.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-dead-claim-'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const target = path.join(root, 'memory.fixture');
const lock = target + '.rsp-lock';
const file = path.join(root, 'worker.mjs');
fs.writeFileSync(file, `import fs from 'node:fs';
import { createRequire } from 'node:module';
const nativeRequire = createRequire(import.meta.url);
const __rufloReq = name => name === 'fs' && process.env.RSP_TEST_FENCE_PERMISSION
  ? { ...fs, lstatSync(file) { if (String(file).endsWith('.recovery')) { const error = new Error('fixture fence denied'); error.code = 'EACCES'; throw error; } return fs.lstatSync(file); } }
  : nativeRequire(name);
${MEMORY_LOCK_SOURCE}
const target = ${JSON.stringify(target)};
const keepAlive = setInterval(() => {}, 1000);
await __rufloWithLock(target, async () => {
  fs.writeFileSync(target + '.active', String(process.pid), { flag: 'wx' });
  if (process.argv[2] === 'hold') {
    fs.writeFileSync(target + '.ready', 'ready');
    await new Promise(() => {});
  }
  await new Promise(resolve => setTimeout(resolve, 25));
  fs.appendFileSync(target + '.receipts', process.pid + '\\n');
  fs.unlinkSync(target + '.active');
});
clearInterval(keepAlive);
`);
function start(mode) {
  const child = spawn(process.execPath, [file, ...(mode ? [mode] : [])], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', s => { stderr += s; });
  const done = new Promise(resolve => child.on('exit', (code, signal) => resolve({ code, signal, stderr })));
  return { child, done };
}
try {
  const victim = start('hold');
  const deadline = Date.now() + 3000;
  while (!fs.existsSync(target + '.ready') && Date.now() < deadline) await delay(10);
  check(fs.existsSync(lock), 'victim acquired the real injected lock');
  const original = fs.readFileSync(lock, 'utf8');
  victim.child.kill('SIGKILL');
  check((await victim.done).signal === 'SIGKILL', 'hard-killed owner leaves its claim');
  fs.unlinkSync(target + '.active'); // fixture marker only, never lock or managed storage
  const results = await Promise.all(Array.from({ length: 12 }, () => start().done));
  check(results.every(r => r.code === 0), 'racing recovery contenders all finish without overlapping work');
  const archives = fs.readdirSync(root).filter(n => n.startsWith('memory.fixture.rsp-lock.dead-'));
  check(archives.length === 1 && fs.readFileSync(path.join(root, archives[0]), 'utf8') === original,
    'one recovery preserves the exact dead claim');
  check(!fs.existsSync(lock) && !fs.existsSync(lock + '.recovery'), 'normal completion releases its lock and recovery gate');
  check(fs.readFileSync(target + '.receipts', 'utf8').trim().split('\n').length === 12,
    'every serialized operation has one fixture receipt');

  // No age, malformed metadata, symlink, or ambiguous gate authorizes a steal.
  const live = JSON.stringify({ pid: process.pid, token: process.pid + ':live:owner' });
  fs.writeFileSync(lock, live);
  const epoch = new Date(0); fs.utimesSync(lock, epoch, epoch);
  check(spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: 8000 }).status !== 0,
    'even ancient live ownership refuses entry');
  check(fs.readFileSync(lock, 'utf8') === live, 'live claim is unchanged');
  fs.unlinkSync(lock);
  fs.writeFileSync(lock, '{malformed');
  check(spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: 8000 }).status !== 0,
    'unproved metadata refuses entry');
  check(fs.readFileSync(lock, 'utf8') === '{malformed', 'invalid metadata is preserved');
  fs.unlinkSync(lock);
  const foreign = path.join(root, 'foreign.claim'); fs.writeFileSync(foreign, original);
  fs.symlinkSync(foreign, lock);
  check(spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: 8000 }).status !== 0,
    'symlink ownership refuses entry');
  check(fs.lstatSync(lock).isSymbolicLink() && fs.readFileSync(foreign, 'utf8') === original, 'symlink and target are preserved');
  fs.unlinkSync(lock);
  fs.mkdirSync(lock + '.recovery');
  check(spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: 8000 }).status !== 0,
    'an abandoned or unknown recovery fence fails closed');
  check(fs.existsSync(lock + '.recovery') && !fs.existsSync(lock), 'foreign recovery gate is never removed');
  fs.rmdirSync(lock + '.recovery');
  fs.symlinkSync(path.join(root, 'absent-fence-target'), lock + '.recovery');
  check(spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: 8000 }).status !== 0,
    'a dangling recovery symlink also refuses entry');
  check(fs.lstatSync(lock + '.recovery').isSymbolicLink() && !fs.existsSync(lock), 'dangling recovery fence is preserved');
  fs.unlinkSync(lock + '.recovery');
  check(spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: 8000,
    env: { ...process.env, RSP_TEST_FENCE_PERMISSION: '1' } }).status !== 0,
    'unreadable recovery-fence metadata is not absence');
  check(!fs.existsSync(lock), 'permission uncertainty never enters or publishes a claim');
  console.log('memory-lock-recovery: ' + checks + ' checks passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
