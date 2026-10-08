import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MEMORY_LOCK_SOURCE } from '../lib/cwd/memory-lock-source.mjs';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-fence-operator-')));
process.env.RUFLO_SOURCE_PATCH_HOME = root; // Existing explicit test isolation owner; HOME is deliberately ignored.
const { inspectMemoryFence, recoverMemoryFence, recoverMemoryFenceFile } = await import('../lib/cwd/memory-fence-recovery.mjs');
const { PATCH_MUTATION_LOCK_PATH } = await import('../lib/cwd/state.mjs');
assert.ok(PATCH_MUTATION_LOCK_PATH.startsWith(root + path.sep), 'operator serialization must be isolated');
const boot = { platform: 'darwin', bootId: '00000000-0000-0000-0000-000000000001', bootTimeMs: Date.now() - 1000 };
const deceased = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' }).pid;
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const fails = (fn, pattern) => { assert.throws(fn, pattern); checks++; };
function fixture(name) {
  const directory = path.join(root, name); fs.mkdirSync(directory, { mode: 0o700 });
  const databasePath = path.join(directory, 'memory.db');
  fs.writeFileSync(databasePath, 'not a database: must never be opened');
  fs.writeFileSync(databasePath + '-wal', 'untouched WAL sentinel');
  fs.writeFileSync(databasePath + '-shm', 'untouched SHM sentinel');
  const lock = databasePath + '.rsp-lock', gate = lock + '.recovery';
  fs.writeFileSync(lock, JSON.stringify({ pid: deceased, token: deceased + ':fixture:claim' }), { mode: 0o600 });
  fs.mkdirSync(gate, { mode: 0o700 });
  const fds = new Set();
  // Fixtures cannot really predate this machine boot. Only synthetic stat timestamps differ;
  // paths, file descriptors, mode/owner, identity changes, PID checks and rename are real.
  const old = st => {
    const result = Object.create(st);
    for (const key of ['birthtimeMs', 'mtimeMs', 'ctimeMs']) result[key] = st[key] - 60000;
    return result;
  };
  const io = { ...fs,
    lstatSync(file) { const st = fs.lstatSync(file); return [lock, gate].includes(file) ? old(st) : st; },
    openSync(file, ...args) {
      if ([databasePath, databasePath + '-wal', databasePath + '-shm'].includes(file)) throw new Error('managed file access forbidden');
      const fd = fs.openSync(file, ...args); if (file === lock) fds.add(fd); return fd;
    },
    fstatSync(fd) { const st = fs.fstatSync(fd); return fds.has(fd) ? old(st) : st; },
    closeSync(fd) { fds.delete(fd); fs.closeSync(fd); },
  };
  const options = { io, readBoot: () => boot };
  const expected = inspectMemoryFence(databasePath, options);
  return { databasePath, lock, gate, directory, io, options, expected };
}
try {
  const good = fixture('good');
  const claim = fs.readFileSync(good.lock, 'utf8');
  const result = recoverMemoryFence(good.expected, good.options);
  check(result.status === 'fence-archived' && result.memoryHealthVerified === false, 'disposition does not claim healthy memory');
  check(fs.lstatSync(path.join(result.archive, 'fence')).ino === good.expected.fence.ino,
    'the exact empty fence is preserved, not deleted');
  check(fs.readFileSync(good.lock, 'utf8') === claim, 'original writer claim is unchanged by operator');
  check(JSON.parse(fs.readFileSync(path.join(result.archive, 'intent.json'))).status === 'prepared'
    && JSON.parse(fs.readFileSync(path.join(result.archive, 'result.json'))).status === 'fence-archived', 'durable intent and completion receipts retained');
  check(fs.readFileSync(good.databasePath, 'utf8').startsWith('not a database')
    && fs.readFileSync(good.databasePath + '-wal', 'utf8') === 'untouched WAL sentinel'
    && fs.readFileSync(good.databasePath + '-shm', 'utf8') === 'untouched SHM sentinel', 'database and sidecars are untouched');

  // Existing injected native owner, not the new operator, performs dead-claim recovery.
  const worker = path.join(root, 'native-owner.mjs');
  fs.writeFileSync(worker, `import { createRequire } from 'node:module';
const __rufloReq = createRequire(import.meta.url);
${MEMORY_LOCK_SOURCE}
await __rufloWithLock(${JSON.stringify(good.databasePath)}, async () => console.log('native-owner-entered'));
`);
  const native = spawnSync(process.execPath, [worker], { encoding: 'utf8', timeout: 10000 });
  check(native.status === 0 && native.stdout.includes('native-owner-entered'), 'existing native protocol resumes after explicit disposition');
  const dead = fs.readdirSync(good.directory).filter(name => name.startsWith('memory.db.rsp-lock.dead-'));
  check(dead.length === 1 && fs.readFileSync(path.join(good.directory, dead[0]), 'utf8') === claim,
    'existing native owner retains exact original dead claim');
  fails(() => recoverMemoryFence(good.expected, good.options), /ENOENT/);

  const sameBoot = fixture('same-boot');
  fails(() => recoverMemoryFence(sameBoot.expected, { ...sameBoot.options, io: fs }), /older than the current boot/);
  const nonempty = fixture('nonempty'); fs.writeFileSync(path.join(nonempty.gate, 'unknown'), 'retain');
  fails(() => recoverMemoryFence(nonempty.expected, nonempty.options), /empty, owned/);
  check(fs.existsSync(path.join(nonempty.gate, 'unknown')), 'nonempty fence remains untouched');
  const symlink = fixture('symlink'); fs.renameSync(symlink.gate, symlink.gate + '-original'); fs.symlinkSync(symlink.gate + '-original', symlink.gate);
  fails(() => recoverMemoryFence(symlink.expected, symlink.options), /empty, owned/);
  const alias = fixture('parent-alias'); const aliasDir = path.join(root, 'alias'); fs.symlinkSync(alias.directory, aliasDir);
  fails(() => inspectMemoryFence(path.join(aliasDir, 'memory.db'), alias.options), /parent contains a symlink/);
  const changed = fixture('changed'); changed.expected.fence.ino++;
  fails(() => recoverMemoryFence(changed.expected, changed.options), /identity changed/);
  const live = fixture('live'); fs.writeFileSync(live.lock, JSON.stringify({ pid: process.pid, token: process.pid + ':live' }));
  fails(() => recoverMemoryFence(live.expected, live.options), /PID is live or unproved/);
  const malformed = fixture('malformed'); fs.writeFileSync(malformed.lock, '{}');
  fails(() => recoverMemoryFence(malformed.expected, malformed.options), /PID is live or unproved/);
  const denied = fixture('pid-permission');
  fails(() => recoverMemoryFence(denied.expected, { ...denied.options, isPidGone: () => false }), /PID is live or unproved/);
  const wrongBoot = fixture('wrong-boot');
  fails(() => recoverMemoryFence(wrongBoot.expected, { ...wrongBoot.options,
    readBoot: () => ({ ...boot, bootId: '00000000-0000-0000-0000-000000000002' }) }), /identity changed/);
  const wrongSource = fixture('wrong-source'); wrongSource.expected.lockSourceSha256 = '0'.repeat(64);
  fails(() => recoverMemoryFence(wrongSource.expected, wrongSource.options), /identity changed/);
  const unknown = fixture('unknown-field'); unknown.expected.approveAnything = true;
  fails(() => recoverMemoryFence(unknown.expected, unknown.options), /identity changed/);

  const racing = fixture('drift-after-intent');
  const originalWrite = racing.io.writeFileSync;
  racing.io.writeFileSync = (...args) => {
    const answer = originalWrite(...args);
    fs.writeFileSync(racing.lock, JSON.stringify({ pid: deceased, token: deceased + ':replacement' }));
    return answer;
  };
  fails(() => recoverMemoryFence(racing.expected, racing.options), /identity changed/);
  check(fs.existsSync(racing.gate), 'post-intent drift leaves active fence in place');
  const archives = fs.readdirSync(racing.directory).filter(name => name.includes('recovery-archive-'));
  check(archives.length === 1 && fs.existsSync(path.join(racing.directory, archives[0], 'intent.json'))
    && !fs.existsSync(path.join(racing.directory, archives[0], 'result.json')), 'failed attempt retains intent without false completion');
  const durable = fixture('receipt-failure'); durable.io.fsyncSync = () => { throw new Error('synthetic fsync failure'); };
  fails(() => recoverMemoryFence(durable.expected, durable.options), /synthetic fsync failure/);
  check(fs.existsSync(durable.gate), 'receipt persistence failure cannot remove active fence');

  for (const replacement of ['content', 'symlink']) {
    const race = fixture(`rename-race-${replacement}`);
    race.io.renameSync = (from, to) => {
      if (replacement === 'content') fs.writeFileSync(path.join(from, 'unexpected'), 'preserve');
      else { fs.renameSync(from, from + '-original'); fs.symlinkSync(from + '-original', from); }
      fs.renameSync(from, to);
    };
    fails(() => recoverMemoryFence(race.expected, race.options), /archive identity mismatch/);
    check(fs.lstatSync(race.gate).isDirectory(), 'post-rename refusal recreates an exclusive fail-closed marker');
    const attempt = fs.readdirSync(race.directory).find(name => name.includes('recovery-archive-'));
    check(JSON.parse(fs.readFileSync(path.join(race.directory, attempt, 'failure.json'))).status === 'failed',
      'post-rename failure is retained distinctly from completion');
  }
  for (const successor of [false, true]) {
    const fail = fixture(`completion-write-failure-${successor}`);
    const write = fail.io.writeFileSync;
    fail.io.writeFileSync = (fd, content, ...args) => {
      if (content.includes('"status": "fence-archived"')) {
        if (successor) { fs.mkdirSync(fail.gate); fs.writeFileSync(path.join(fail.gate, 'successor'), 'owned'); }
        throw new Error('synthetic completion receipt failure');
      }
      return write(fd, content, ...args);
    };
    fails(() => recoverMemoryFence(fail.expected, fail.options), /completion receipt failure/);
    check(fs.existsSync(fail.gate), 'completion receipt failure restores refusal');
    if (successor) check(fs.readFileSync(path.join(fail.gate, 'successor'), 'utf8') === 'owned', 'successor fence is never overwritten');
    const archived = fs.readdirSync(fail.directory).find(name => name.includes('recovery-archive-'));
    const failure = JSON.parse(fs.readFileSync(path.join(fail.directory, archived, 'failure.json')));
    check(failure.refusalMarker === (successor ? 'successor-present' : 'created'), 'failure receipt records actual refusal disposition');
  }

  const expectedFile = path.join(root, 'expected.json'); fs.writeFileSync(expectedFile, JSON.stringify(sameBoot.expected));
  // The public CLI has no synthetic-boot flag; even a prepared fixture cannot authorize it.
  const cli = spawnSync(process.execPath, [new URL('../bin/cli.mjs', import.meta.url).pathname,
    'memory', 'recover-fence', expectedFile], { encoding: 'utf8', timeout: 10000,
    env: { ...process.env, RSP_NO_SELF_UPDATE: '1', RSP_NO_LAUNCHCTL: '1' } });
  check(cli.status === 1 && /older than the current boot|only on macOS/.test(cli.stderr), 'CLI refuses fabricated preboot expectation using actual OS');
  const linked = path.join(root, 'expected-link.json'); fs.symlinkSync(expectedFile, linked);
  fails(() => recoverMemoryFenceFile(linked), /bounded regular JSON file/);
  check(fs.existsSync(sameBoot.gate), 'public refusal leaves fence intact');
  console.log(`memory-fence-recovery: ${checks} checks passed`);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
