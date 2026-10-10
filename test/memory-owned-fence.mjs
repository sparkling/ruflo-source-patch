import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { MEMORY_LOCK_SOURCE } from '../lib/cwd/memory-lock-source.mjs';
import { MEMORY_LOCK_SOURCE as OLD_LOCK_SOURCE } from '../lib/cwd/memory-lock-source-v1.mjs';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rsp-owned-fence-')));
process.env.RUFLO_SOURCE_PATCH_HOME = root;
const { inspectMemoryFence, recoverMemoryFence } = await import('../lib/cwd/memory-fence-recovery.mjs');
const { PATCH_MUTATION_LOCK_PATH } = await import('../lib/cwd/state.mjs');
assert.ok(PATCH_MUTATION_LOCK_PATH.startsWith(root + path.sep));
const deceased = spawnSync(process.execPath, ['-e', '']).pid;
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const fails = (fn, pattern = /refused/) => { assert.throws(fn, pattern); checks++; };
const sentinels = new Map();
function fixture(name, { absent = false, owner = deceased } = {}) {
  const directory = path.join(root, name); fs.mkdirSync(directory, { mode: 0o700 });
  const databasePath = path.join(directory, 'memory.db');
  for (const suffix of ['', '-wal', '-shm']) {
    const file = databasePath + suffix, bytes = `never open managed sentinel ${suffix}`;
    fs.writeFileSync(file, bytes); sentinels.set(file, bytes);
  }
  const lock = databasePath + '.rsp-lock', gate = lock + '.recovery';
  if (!absent) fs.writeFileSync(lock, JSON.stringify({ pid: deceased, token: deceased + ':dead:claim' }), { mode: 0o600 });
  const ownerBytes = JSON.stringify({ schema: 'rsp-memory-recovery-owner/v1', pid: owner,
    token: owner + ':fixture:recovery', lockFile: lock });
  fs.writeFileSync(gate, ownerBytes, { mode: 0o600 });
  const io = { ...fs, openSync(file, ...args) {
    if (sentinels.has(String(file))) throw new Error('managed sentinel opened');
    return fs.openSync(file, ...args);
  } };
  return { databasePath, directory, lock, gate, ownerBytes, options: { io } };
}
function inspect(f) { return inspectMemoryFence(f.databasePath, f.options); }
function run(file, args = []) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [file, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', bytes => { output += bytes; });
    child.stderr.on('data', bytes => { output += bytes; });
    child.on('exit', code => resolve({ code, output }));
  });
}
try {
  const { ENTRIES, composeCliContribution, historicalCliContribution } = await import('../lib/cwd/patch-library.mjs');
  const entry = ENTRIES.find(e => e.id === 'memory/write-lock');
  const pristine = '//# sourceMappingURL=memory-initializer.js.map';
  const composed = composeCliContribution(pristine, [entry]).next;
  const previous = composed.replace(MEMORY_LOCK_SOURCE, OLD_LOCK_SOURCE);
  check(historicalCliContribution(pristine, previous, [entry]).next === previous,
    'previous released runtime has exact shared-composition provenance');
  check(entry.proof === MEMORY_LOCK_SOURCE && !previous.includes(entry.proof),
    'status cannot report old lock implementation as current');
  const unknown = previous.replace('let gateStat, fd;', 'let gateStat, fd, unknown;');
  check(historicalCliContribution(pristine, unknown, [entry]).next !== unknown,
    'unknown historical mutation does not gain source ownership');
  const good = fixture('owned');
  const expected = inspect(good), claim = fs.readFileSync(good.lock, 'utf8');
  const result = recoverMemoryFence(expected, good.options);
  check(result.status === 'fence-archived' && result.memoryHealthVerified === false,
    'same-boot dead recovery owner can be archived without claiming database health');
  check(fs.readFileSync(path.join(result.archive, 'fence'), 'utf8') === good.ownerBytes,
    'archive retains exact recovery ownership bytes');
  check(fs.lstatSync(path.join(result.archive, 'fence')).ino === expected.fence.ino,
    'archive retains exact fence inode');
  check(fs.readFileSync(good.lock, 'utf8') === claim, 'operator leaves original writer claim unchanged');
  check(JSON.parse(fs.readFileSync(path.join(result.archive, 'intent.json'))).status === 'prepared'
    && JSON.parse(fs.readFileSync(path.join(result.archive, 'result.json'))).status === 'fence-archived',
  'durable intent and completion receipts distinguish disposition');

  const absent = fixture('absent', { absent: true }), absentExpected = inspect(absent);
  check(absentExpected.claim === null, 'absent writer claim is explicit evidence');
  recoverMemoryFence(absentExpected, absent.options);
  check(!fs.existsSync(absent.lock), 'operator does not manufacture an absent writer claim');
  const live = fixture('live', { owner: process.pid });
  fails(() => inspect(live));
  check(fs.readFileSync(live.gate, 'utf8') === live.ownerBytes, 'live or reused PID stays refused');
  const malformed = fixture('malformed'); fs.writeFileSync(malformed.gate, '{}'); fails(() => inspect(malformed));
  const linked = fixture('symlink'); fs.renameSync(linked.gate, linked.gate + '-original');
  fs.symlinkSync(linked.gate + '-original', linked.gate); fails(() => inspect(linked));
  const wrongPath = fixture('wrong-path');
  fs.writeFileSync(wrongPath.gate, wrongPath.ownerBytes.replace(wrongPath.lock, '/other/memory.db.rsp-lock'));
  fails(() => inspect(wrongPath));
  const drift = fixture('owner-drift'), driftExpected = inspect(drift);
  fs.writeFileSync(drift.gate, drift.ownerBytes.replace(':fixture:', ':changed:'));
  fails(() => recoverMemoryFence(driftExpected, drift.options));
  const claimDrift = fixture('claim-drift'), claimExpected = inspect(claimDrift);
  fs.writeFileSync(claimDrift.lock, JSON.stringify({ pid: deceased, token: deceased + ':replacement' }));
  fails(() => recoverMemoryFence(claimExpected, claimDrift.options));
  const absentDrift = fixture('absent-drift', { absent: true }), absentDriftExpected = inspect(absentDrift);
  fs.writeFileSync(absentDrift.lock, JSON.stringify({ pid: deceased, token: deceased + ':new' }));
  fails(() => recoverMemoryFence(absentDriftExpected, absentDrift.options));
  const recheck = fixture('under-lock-recheck'), recheckExpected = inspect(recheck);
  fails(() => recoverMemoryFence(recheckExpected, { ...recheck.options, underLock(fn) {
    fs.writeFileSync(recheck.gate, recheck.ownerBytes.replace(':fixture:', ':concurrent:')); return fn();
  } }));
  check(fs.existsSync(recheck.gate), 'operator rechecks after serialization before mutation');
  const durability = fixture('durability'), durabilityExpected = inspect(durability);
  fails(() => recoverMemoryFence(durabilityExpected, { ...durability.options,
    io: { ...durability.options.io, fsyncSync() { throw new Error('fixture durability failure'); } } }), /durability failure/);
  check(fs.existsSync(durability.gate), 'failed intent durability leaves active fence intact');

  // A real child dies immediately after exclusive publication, before writer recovery.
  const crash = fixture('crash'); fs.unlinkSync(crash.gate);
  const worker = path.join(root, 'native-owner.mjs');
  fs.writeFileSync(worker, `import fs from 'node:fs';
import { createRequire } from 'node:module';
const native = createRequire(import.meta.url);
const target = process.argv[2];
let directorySyncs = 0;
const __rufloReq = name => name === 'fs' && ['crash', 'live', 'publication-fsync', 'archive-fsync'].includes(process.argv[3])
  ? { ...fs, fsyncSync(fd) {
    if (fs.fstatSync(fd).isDirectory()) {
      directorySyncs++;
      if ((process.argv[3] === 'publication-fsync' && directorySyncs === 1)
        || (process.argv[3] === 'archive-fsync' && directorySyncs === 2))
        throw new Error('fixture parent fsync failed');
    }
    return fs.fsyncSync(fd);
  }, linkSync(from, to) {
    if (process.argv[3] === 'live' && to === target + '.rsp-lock.recovery') {
      fs.writeFileSync(target + '.unexpected-publication', 'attempted');
      throw new Error('live writer must never publish recovery fence');
    }
    const result = fs.linkSync(from, to);
    if (process.argv[3] === 'crash' && to === target + '.rsp-lock.recovery') process.kill(process.pid, 'SIGKILL');
    return result; } } : native(name);
${MEMORY_LOCK_SOURCE}
await __rufloWithLock(target, async () => console.log('fixture-native-entered'));
`);
  const originalClaim = fs.readFileSync(crash.lock, 'utf8');
  const killed = spawnSync(process.execPath, [worker, crash.databasePath, 'crash'], { encoding: 'utf8', timeout: 10000 });
  check(killed.signal === 'SIGKILL', 'actual recovery owner dies after atomic publication');
  check(fs.lstatSync(crash.gate).isFile(), 'published fence is regular owner record');
  const published = fs.readFileSync(crash.gate, 'utf8');
  check(JSON.parse(published).pid === killed.pid, 'published owner identifies actual recovery child');
  const recovered = recoverMemoryFence(inspect(crash), crash.options);
  check(fs.readFileSync(path.join(recovered.archive, 'fence'), 'utf8') === published,
    'real interrupted publication ownership is archived exactly');
  check(fs.readFileSync(crash.lock, 'utf8') === originalClaim, 'operator preserves dead writer before native retry');
  const retry = spawnSync(process.execPath, [worker, crash.databasePath], { encoding: 'utf8', timeout: 10000 });
  check(retry.status === 0 && retry.stdout.includes('fixture-native-entered'), 'native lock owner resumes after explicit disposition');
  const dead = fs.readdirSync(crash.directory).filter(name => name.startsWith('memory.db.rsp-lock.dead-'));
  check(dead.length === 1 && fs.readFileSync(path.join(crash.directory, dead[0]), 'utf8') === originalClaim,
    'native retry preserves exact old writer evidence');
  const activeWriter = fixture('active-writer'); fs.unlinkSync(activeWriter.gate);
  fs.writeFileSync(activeWriter.lock, JSON.stringify({ pid: process.pid, token: process.pid + ':active' }));
  const contention = spawnSync(process.execPath, [worker, activeWriter.databasePath, 'live'],
    { encoding: 'utf8', timeout: 8000 });
  check(contention.status !== 0 && contention.signal === null, 'live writer contention safely times out');
  check(!fs.existsSync(activeWriter.databasePath + '.unexpected-publication'),
    'live writer contention never calls recovery fence linkSync');
  for (const stage of ['publication-fsync', 'archive-fsync']) {
    const durabilityStage = fixture(stage); fs.unlinkSync(durabilityStage.gate);
    const previous = fs.readFileSync(durabilityStage.lock, 'utf8');
    const failed = spawnSync(process.execPath, [worker, durabilityStage.databasePath, stage],
      { encoding: 'utf8', timeout: 8000 });
    check(failed.status !== 0 && failed.signal === null && !failed.stdout.includes('fixture-native-entered'),
      stage + ' failure never enters native operation');
    check(fs.existsSync(durabilityStage.gate) && fs.lstatSync(durabilityStage.gate).isFile(),
      stage + ' failure preserves owned recovery refusal');
    const evidence = fs.existsSync(durabilityStage.lock) ? durabilityStage.lock
      : path.join(durabilityStage.directory, fs.readdirSync(durabilityStage.directory)
        .find(name => name.startsWith('memory.db.rsp-lock.dead-')));
    check(fs.readFileSync(evidence, 'utf8') === previous, stage + ' preserves original writer bytes');
  }

  const mixed = fixture('mixed'); fs.unlinkSync(mixed.gate);
  const mixedClaim = fs.readFileSync(mixed.lock, 'utf8');
  const mixedWorkers = [OLD_LOCK_SOURCE, MEMORY_LOCK_SOURCE].map((source, index) => {
    const file = path.join(root, `mixed-${index}.mjs`);
    fs.writeFileSync(file, `import fs from 'node:fs';
import { createRequire } from 'node:module';
const __rufloReq = createRequire(import.meta.url);
${source}
await __rufloWithLock(${JSON.stringify(mixed.databasePath)}, async () => {
  const marker = ${JSON.stringify(mixed.databasePath + '.active')};
  fs.writeFileSync(marker, 'exclusive fixture work', { flag: 'wx' });
  await new Promise(resolve => setTimeout(resolve, 20)); fs.unlinkSync(marker);
});`);
    return file;
  });
  const mixedResults = await Promise.all(Array.from({ length: 12 }, (_, i) => run(mixedWorkers[i % 2])));
  check(mixedResults.every(r => r.code === 0), 'mixed old and new native contenders never overlap');
  const mixedArchives = fs.readdirSync(mixed.directory).filter(name => name.startsWith('memory.db.rsp-lock.dead-'));
  check(mixedArchives.length === 1 && fs.readFileSync(path.join(mixed.directory, mixedArchives[0]), 'utf8') === mixedClaim,
    'mixed versions recover and preserve original claim exactly once');

  const concurrent = fixture('concurrent-operators'), concurrentExpected = inspect(concurrent);
  const operator = path.join(root, 'operator.mjs');
  const moduleUrl = new URL('../lib/cwd/memory-fence-recovery.mjs', import.meta.url).href;
  fs.writeFileSync(operator, `import { recoverMemoryFence } from ${JSON.stringify(moduleUrl)};
recoverMemoryFence(${JSON.stringify(concurrentExpected)});`);
  const attempts = await Promise.all(Array.from({ length: 4 }, () => run(operator)));
  check(attempts.filter(r => r.code === 0).length === 1, 'concurrent operators permit exactly one disposition');
  const completed = fs.readdirSync(concurrent.directory).filter(name => name.includes('.recovery-archive-')
    && fs.existsSync(path.join(concurrent.directory, name, 'result.json')));
  check(completed.length === 1, 'only one concurrent operator emits a completed receipt');

  const receipt = fixture('completion-receipt-failure'), receiptExpected = inspect(receipt);
  const receiptIo = { ...receipt.options.io, writeFileSync(fd, bytes, ...args) {
    if (String(bytes).includes('"status": "fence-archived"')) throw new Error('fixture completion receipt failed');
    return fs.writeFileSync(fd, bytes, ...args);
  } };
  fails(() => recoverMemoryFence(receiptExpected, { io: receiptIo }), /completion receipt failed/);
  check(fs.readFileSync(receipt.gate, 'utf8') === receipt.ownerBytes,
    'completion receipt failure restores exact owner-aware refusal rather than empty directory');
  check(inspect(receipt).fenceKind === 'owned-file', 'restored owned refusal retains supported diagnostic route');
  for (const [file, bytes] of sentinels) assert.equal(fs.readFileSync(file, 'utf8'), bytes);
  check(true, 'all database and sidecar sentinels remain byte-identical');
  console.log(`memory-owned-fence: ${checks} checks passed`);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
