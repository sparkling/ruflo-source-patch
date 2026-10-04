import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { FRAGMENTS } from '../lib/cwd/patch-library.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-lock-termination-'));
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks += 1; };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function fixture(name, { before = '', after = '', work = 'await new Promise(() => {});' } = {}) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir);
  const file = path.join(dir, 'owner.mjs');
  const target = path.join(dir, 'memory.fixture');
  fs.writeFileSync(file, `import fs from 'node:fs';
import { createRequire } from 'node:module';
const __rufloReq = createRequire(import.meta.url);
const target = ${JSON.stringify(target)};
${before}
${FRAGMENTS.memLock.src}
${after}
setInterval(() => {}, 1000);
await __rufloWithLock(target, async () => {
  fs.writeFileSync(target + '.ready', 'ready');
  ${work}
});
fs.writeFileSync(target + '.done', 'done');
process.exit(0);
`);
  return { file, target, lock: target + '.rsp-lock' };
}
async function start(f) {
  const child = spawn(process.execPath, [f.file], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = new Promise(resolve => child.on('exit', (code, signal) => resolve({ code, signal, stderr })));
  const deadline = Date.now() + 3000;
  while (!fs.existsSync(f.target + '.ready') && Date.now() < deadline && child.exitCode === null) await delay(10);
  assert.ok(fs.existsSync(f.target + '.ready'), `fixture did not acquire: ${stderr}`);
  return { child, exited };
}

try {
  // The native hook runner uses spawnSync(timeout), which sends SIGTERM to its child.
  const timed = fixture('timeout');
  const timeout = spawnSync(process.execPath, [timed.file], { timeout: 700, encoding: 'utf8' });
  check(timeout.error?.code === 'ETIMEDOUT' && timeout.signal === 'SIGTERM', 'native timeout retains SIGTERM termination');
  check(fs.existsSync(timed.target + '.ready'), 'timed owner held a lock');
  check(!fs.existsSync(timed.lock), 'SIGTERM timeout removes its own claim');

  const interrupted = fixture('interrupt');
  const interrupt = await start(interrupted);
  interrupt.child.kill('SIGINT');
  const stopped = await interrupt.exited;
  check(stopped.signal === 'SIGINT' && stopped.code === null, 'SIGINT retains default signal exit');
  check(!fs.existsSync(interrupted.lock), 'SIGINT removes its own claim');

  // Native handlers keep ownership until completion, even when registered after our fragment.
  for (const position of ['before', 'after']) {
    const handler = "process.on('SIGTERM', () => fs.writeFileSync(target + '.native', 'handled'));";
    const f = fixture(`native-${position}`, { [position]: handler, work: 'await new Promise(resolve => setTimeout(resolve, 500));' });
    const running = await start(f);
    running.child.kill('SIGTERM');
    await delay(80);
    check(fs.existsSync(f.target + '.native') && fs.existsSync(f.lock), `${position} native handler retains in-flight lock`);
    const result = await running.exited;
    check(result.code === 0 && !fs.existsSync(f.lock), `${position} native completion releases normally`);
  }
  const once = fixture('native-once', { after: "process.prependOnceListener('SIGTERM', () => fs.writeFileSync(target + '.native', 'handled'));", work: 'await new Promise(resolve => setTimeout(resolve, 500));' });
  const onceRunning = await start(once);
  onceRunning.child.kill('SIGTERM');
  await delay(80);
  check(fs.existsSync(once.lock), 'removed native once-handler still owns graceful shutdown');
  check((await onceRunning.exited).code === 0 && !fs.existsSync(once.lock), 'native once-handler completion releases normally');

  const removed = fixture('native-removed', { after: "const native = () => {}; process.on('SIGINT', native); process.removeListener('SIGINT', native);" });
  const removedRunning = await start(removed);
  removedRunning.child.kill('SIGINT');
  check((await removedRunning.exited).signal === 'SIGINT', 'native handler removal restores default termination, never a no-op');

  const nativeExit = fixture('native-exit', { before: "process.on('SIGTERM', () => process.exit(0));" });
  const exitRunning = await start(nativeExit);
  exitRunning.child.kill('SIGTERM');
  check((await exitRunning.exited).code === 0, 'native exit policy is preserved');
  check(!fs.existsSync(nativeExit.lock), 'native process exit retains owner-safe cleanup');

  for (const kind of ['token', 'inode']) {
    const mutation = kind === 'token'
      ? "const claim = JSON.parse(fs.readFileSync(target + '.rsp-lock')); claim.token = 'replacement'; fs.writeFileSync(target + '.rsp-lock', JSON.stringify(claim));"
      : "const claim = fs.readFileSync(target + '.rsp-lock'); fs.unlinkSync(target + '.rsp-lock'); fs.writeFileSync(target + '.rsp-lock', claim);";
    const f = fixture(`foreign-${kind}`, { work: `${mutation}\nfs.writeFileSync(target + '.changed', 'changed'); await new Promise(() => {});` });
    const running = await start(f);
    while (!fs.existsSync(f.target + '.changed')) await delay(5);
    running.child.kill('SIGTERM');
    check((await running.exited).signal === 'SIGTERM', `${kind} mismatch preserves termination`);
    check(fs.existsSync(f.lock), `${kind} mismatch never removes replacement claim`);
  }

  const sync = fixture('synchronous', { work: "const until = Date.now() + 250; while (Date.now() < until) {} fs.writeFileSync(target, 'complete synchronous write');" });
  const syncRunning = await start(sync);
  syncRunning.child.kill('SIGTERM');
  await syncRunning.exited;
  check(fs.readFileSync(sync.target, 'utf8') === 'complete synchronous write', 'signal does not interrupt synchronous legacy write');
  check(!fs.existsSync(sync.lock), 'synchronous completion removes owned claim');
  console.log(`memory-lock-termination: ${checks} checks passed`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
