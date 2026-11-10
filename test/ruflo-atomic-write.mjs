import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-atomic-write-')));
process.env.RUFLO_SOURCE_PATCH_HOME = path.join(root, 'patch-home');
process.env.RUFLO_GLOBAL_ROOT = path.join(root, 'global');
process.env.RUFLO_NPX_ROOT = path.join(root, 'npx');
process.env.RSP_CODEX_HOME = path.join(root, '.codex');
const patch = await import('../lib/ruflo-atomic-write/patcher.mjs');
const compose = await import('../lib/plugin-compose.mjs');
const source = fs.readFileSync(new URL('./fixtures/atomic-write-native.js', import.meta.url), 'utf8');
const published = fs.readFileSync(new URL('./fixtures/atomic-write-3.75.0.js', import.meta.url), 'utf8');
assert(patch.nativeSatisfied(published));
assert.equal(patch.patchSource(published).next, published);
assert.equal(patch.reverse(published), published);
for (const mutant of [published.replace('written += n', 'written += data.length'),
  published.replace('n <= 0', 'n < 0'), published.replace('fsyncSync(fd)', 'unprovedSync(fd)')])
  assert(!patch.nativeSatisfied(mutant));
const fixed = patch.patchSource(source);
assert.deepEqual(fixed.missing, []);
assert(patch.isPatched(fixed.next));
assert.equal(patch.reverse(fixed.next), source);
assert.equal(patch.patchSource(fixed.next).next, fixed.next);
const start = 'export function writeFileAtomic(path, data, opts = {}) {\n';
const guarded = source.replace(start, start + '    __rufloRefuseWalSidecars(path);\n    __rufloIntegrityCheck(path);\n');
assert.deepEqual(patch.patchSource(guarded).missing, []);
assert.equal(patch.reverse(patch.patchSource(guarded).next), guarded);
for (const changed of [source + source, source.replace('fsyncSync(fd)', 'unprovedSync(fd)'),
  fixed.next.replace('writeFileSync(fd, data)', 'unprovedWrite(fd, data)')]) {
  assert(patch.patchSource(changed).missing.length);
  assert.equal(patch.patchSource(changed).next, changed);
  assert.equal(patch.reverse(changed), changed);
}

// Extract only the executable helper. No package/root resolver, database,
// learning initializer or native memory client is ever imported or invoked.
const originalWrite = fs.writeSync;
let serial = 0;
function exercise(text, mode, bytes = Buffer.from('new complete content')) {
  const dir = path.join(root, 'case-' + serial++); fs.mkdirSync(dir);
  const file = path.join(dir, 'inert.bin'), prior = Buffer.from('prior complete content');
  fs.writeFileSync(file, prior);
  let calls = 0, syncs = 0, renames = 0, guardCalls = 0, failure;
  const shortWrite = (fd, data, offset, length, position) => {
    calls++;
    if (mode === 'no-progress') return 0;
    if (mode === 'enospc' && calls > 1) throw Object.assign(Error('injected'), { code: 'ENOSPC' });
    return originalWrite(fd, data, offset, Math.min(3, length), position);
  };
  const box = vm.createContext({ ...fs, ...path, Buffer, Date, Math, process: { pid: process.pid },
    writeSync: shortWrite,
    fsyncSync(fd) { if (mode === 'sync' && syncs++ === 0) throw Object.assign(Error('injected'), { code: 'EIO' }); fs.fsyncSync(fd); },
    renameSync(from, to) { renames++; if (mode === 'rename') throw Object.assign(Error('injected'), { code: 'EPERM' }); fs.renameSync(from, to); },
    __rufloRefuseWalSidecars() { guardCalls++; if (mode === 'guard') throw Error('refused'); },
    __rufloIntegrityCheck() { guardCalls++; },
  });
  vm.runInContext(text.slice(text.indexOf('export function')).replace('export function', 'function')
    + '\nglobalThis.atomic = writeFileAtomic;', box);
  // Node's real writeFileSync uses this writeSync export. Every injected short
  // write still calls the real OS writer on our owned temporary descriptor.
  fs.writeSync = shortWrite;
  try { box.atomic(file, bytes); } catch (error) { failure = error; }
  finally { fs.writeSync = originalWrite; }
  const actual = fs.readFileSync(file);
  assert.deepEqual(fs.readdirSync(dir), ['inert.bin'], 'native cleanup leaves no owned temporary file');
  if (['enospc', 'sync', 'rename', 'guard', 'no-progress'].includes(mode)) {
    assert(failure); assert.deepEqual(actual, prior, 'old complete file survives failure');
  } else {
    assert(!failure); assert.deepEqual(actual, mode === 'native-short' ? bytes.subarray(0, 3) : bytes);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
  if (mode === 'guard') assert.equal(calls + renames, 0);
  return { calls, renames, guardCalls };
}
try {
  assert.equal(exercise(source, 'native-short').calls, 1, 'reproduce unchecked native short write');
  assert(exercise(fixed.next, 'short').calls > 1, 'native Node drains all bytes');
  for (const mode of ['enospc', 'sync', 'rename']) exercise(fixed.next, mode);
  assert(exercise(published, 'short').calls > 1);
  for (const mode of ['enospc', 'sync', 'rename', 'no-progress']) exercise(published, mode);
  assert.equal(exercise(published, 'empty', Buffer.alloc(0)).calls, 0);
  const nativeGuarded = published.replace(start, start + '    __rufloRefuseWalSidecars(path);\n    __rufloIntegrityCheck(path);\n');
  assert(patch.nativeSatisfied(nativeGuarded));
  assert.equal(exercise(nativeGuarded, 'short').guardCalls, 2);
  exercise(nativeGuarded, 'guard');
  assert.equal(exercise(fixed.next, 'empty', Buffer.alloc(0)).calls, 0);
  const guardedFixed = patch.patchSource(guarded).next;
  assert.equal(exercise(guardedFixed, 'short').guardCalls, 2);
  exercise(guardedFixed, 'guard');
  const file = path.join(process.env.RUFLO_GLOBAL_ROOT, '@claude-flow/cli/dist/src/fs-secure.js');
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, source);
  assert(patch.preflight([file]).ok);
  const applied = compose.applyComposed([patch.NAME]);
  assert.equal(applied.errors, 0, JSON.stringify(applied));
  assert.equal(applied.incomplete, 0, JSON.stringify(applied));
  assert.equal(fs.readFileSync(file, 'utf8'), fixed.next);
  assert.equal(compose.applyComposed([patch.NAME]).patched, 0);
  assert.equal(compose.reconcile([], [patch.NAME]).errors, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), source);
} finally { fs.writeSync = originalWrite; fs.rmSync(root, { recursive: true, force: true }); }
console.log('PASS atomic write: native truncation reproduced; real Node short-write drain, ENOSPC/sync/rename preservation, cleanup, empty payload, guard order, install/reverse/drift');
