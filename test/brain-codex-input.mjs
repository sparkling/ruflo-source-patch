import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { patchSource, reverseSource, isPatched, readerSource, preflight } from '../lib/brain-codex-input/patcher.mjs';
import { nativeOwnershipSatisfied } from '../lib/brain-wrapper-ownership/native.mjs';

const native = fs.readFileSync(new URL('./fixtures/brain-codex-input/native-4.7.28.mjs', import.meta.url), 'utf8');
const patched = patchSource(native);
assert.deepEqual(patched.missing, []);
assert(isPatched(patched.next));
assert.equal(reverseSource(patched.next), native);
assert.equal(patchSource(patched.next).next, patched.next);
assert(patchSource(native + native).missing.length);
assert(patchSource(native.replace('250)', '251)')).missing.length);
assert(patchSource(patched.next.replace('250)', '251)')).missing.length);
assert(nativeOwnershipSatisfied(fs.readFileSync(new URL('./fixtures/brain-wrapper-ownership/native-4.7.14.mjs', import.meta.url), 'utf8')
  + "\n// The bridge's previous bytes"));
const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-codex-input-')));
const env = { ...process.env, HOME: sandbox, RUFLO_SOURCE_PATCH_HOME: sandbox,
  RSP_RUVNET_BRAIN_HOME: path.join(sandbox, '.cache/ruvnet-brain'),
  CODEX_HOME: path.join(sandbox, '.codex'), RSP_CODEX_HOME: path.join(sandbox, '.codex'),
  RSP_RUVNET_BRAIN_MARKETPLACE: path.join(sandbox, '.claude/plugins/marketplaces/ruvnet-brain'),
  RSP_RUVNET_BRAIN_RUNTIME: path.join(sandbox, '.claude/ruvnet-brain') };
async function run(source, bytes, chunkSize, hold = false) {
  const script = readerSource(source) + '\nprocess.stdout.write(await readHookInput(), () => process.exit(0));';
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const chunks = []; let err = '';
  child.stdout.on('data', b => chunks.push(b)); child.stderr.on('data', b => { err += b; });
  child.stdin.on('error', () => {});
  const completed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(Error('reader exceeded bounded deadline')); }, 3000);
    child.once('error', reject);
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve(Buffer.concat(chunks)) : reject(Error(err || 'exit ' + code)); });
  });
  for (let start = 0; start < bytes.length && child.exitCode === null; start += chunkSize) {
    child.stdin.write(bytes.subarray(start, start + chunkSize));
    if (start + chunkSize < bytes.length) await new Promise(resolve => setTimeout(resolve, 20));
  }
  if (!hold) child.stdin.end();
  return completed;
}
try {
  const large = Buffer.from(JSON.stringify({ value: 'x'.repeat(12000) }));
  const broken = await run(native, large, 4096);
  assert.equal(broken.length, large.length * 2, 'pristine split pipe duplicates every chunk');
  assert.throws(() => JSON.parse(broken));
  for (const size of [4096, 8192, 65536]) {
    assert.deepEqual(await run(patched.next, large, size, true), large, 'full JSON without EOF');
  }
  const unicode = Buffer.from(JSON.stringify({ value: 'é🙂'.repeat(1900) }));
  assert.deepEqual(await run(patched.next, unicode, 4097), unicode, 'split UTF-8 bytes preserved');
  const small = Buffer.from('{"safe":true}');
  assert.deepEqual(await run(patched.next, small, 4096), small);
  const partial = Buffer.from('{"incomplete":');
  assert.deepEqual(await run(patched.next, partial, 4096, true), partial, 'idle returns unchanged incomplete input');
  const invalid = Buffer.from('not JSON');
  assert.deepEqual(await run(patched.next, invalid, 4096), invalid);
  const oversized = Buffer.alloc(1100000, 120);
  const limited = await run(patched.next, oversized, oversized.length);
  assert.equal(limited.length, 1024 * 1024, 'native input cap retained');
  assert.throws(() => JSON.parse(limited));
  // No stream events: exercise the unchanged polling fallback without a live pipe.
  const pollSource = readerSource(patched.next)
    + '\nconst b = await readHookInput(); globalThis.result = b.toString();';
  const { runInNewContext } = await import('node:vm');
  let pending = Buffer.from('{"polled":true}');
  const stream = { on() {}, once() {}, off() {}, pause() {}, resume() {},
    read() { const next = pending; pending = null; return next; } };
  const ctx = { process: { stdin: stream }, Buffer, setTimeout, clearTimeout, setInterval, clearInterval };
  await runInNewContext('(async () => {' + pollSource + '})()', ctx);
  assert.equal(ctx.result, '{"polled":true}');
  let alternate = false;
  stream.read = () => { alternate = !alternate; return alternate ? Buffer.from('x') : null; };
  const started = Date.now();
  await runInNewContext('(async () => {' + pollSource + '})()', ctx);
  assert(Date.now() - started < 1500, 'hard deadline bounds continuously arriving invalid chunks');
  assert(ctx.result.length > 1);

  const brain = env.RSP_RUVNET_BRAIN_HOME;
  const stable = path.join(brain, 'codex-hook.mjs');
  const active = path.join(brain, 'versions/4.7.28');
  const retained = path.join(brain, 'versions/4.7.27');
  const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
  for (const [root, version, suffix] of [[active, '4.7.28', 'active'], [retained, '4.7.27', 'retained']]) {
    write(path.join(root, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'ruvnet-brain', version }));
    write(path.join(root, 'scripts/codex-hook-wrapper.mjs'), native + '\n// ' + suffix);
  }
  write(path.join(brain, 'active.json'), JSON.stringify({ version: '4.7.28', codeRoot: active }));
  const oldFile = path.join(retained, 'scripts/codex-hook-wrapper.mjs');
  write(stable, fs.readFileSync(oldFile));
  const module = fileURLToPath(new URL('../lib/brain-codex-input/patcher.mjs', import.meta.url));
  const probe = () => {
    const p = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import {discover,preflight} from ${JSON.stringify(module)}; const files=discover(); console.log(JSON.stringify({files,...preflight(files)}));`], { env, encoding: 'utf8' });
    assert.equal(p.status, 0, p.stderr); return JSON.parse(p.stdout);
  };
  const before = probe(); assert.equal(before.ok, true, JSON.stringify(before)); assert.equal(before.files.length, 3);
  const compose = fileURLToPath(new URL('../lib/plugin-compose.mjs', import.meta.url));
  const composition = expression => {
    const p = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import {applyComposed,reconcile} from ${JSON.stringify(compose)}; console.log(JSON.stringify(${expression}));`], { env, encoding: 'utf8' });
    assert.equal(p.status, 0, p.stderr); const result = JSON.parse(p.stdout);
    assert.equal(result.errors, 0, JSON.stringify(result));
    assert.equal(result.incomplete || 0, 0, JSON.stringify(result)); return result;
  };
  assert.equal(composition("applyComposed(['brain-codex-input'])").patched, 3);
  assert.equal(composition("applyComposed(['brain-codex-input'])").patched, 0);
  assert.deepEqual(fs.readFileSync(stable), fs.readFileSync(oldFile), 'native retained-generation ownership preserved');
  assert.equal(probe().ok, true);
  assert.equal(preflight([stable]).ok, false, 'stable-only patch cannot break retained ownership');
  assert.equal(composition("reconcile([], ['brain-codex-input'])").restored, 3);
  assert.equal(fs.readFileSync(oldFile, 'utf8'), native + '\n// retained');
  assert.equal(probe().ok, true);
  fs.appendFileSync(stable, '\n// foreign');
  assert.equal(probe().ok, false);
  for (const file of before.files) fs.unlinkSync(file);
  assert.deepEqual(probe(), { files: [], ok: true, errors: [] }, 'unrelated Claude-only surfaces do not require a Codex wrapper');
  console.log('Brain #525: original split-input corruption reproduced; exact bounded single-reader input, open pipe, UTF-8, polling, drift/reversal and stable retained ownership PASS');
} finally { fs.rmSync(sandbox, { recursive: true, force: true }); }
