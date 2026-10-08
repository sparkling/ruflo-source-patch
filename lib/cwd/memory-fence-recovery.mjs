// Explicit operator disposition of an interrupted, preboot recovery fence (#2878, ADR-023).
// This never opens a database or changes a writer claim. The existing native lock owner
// remains responsible for recovering that claim on the next ordinary memory operation.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { withPatchMutationLock } from './state.mjs';
import { MEMORY_LOCK_SOURCE } from './memory-lock-source.mjs';

const schema = 'rsp-memory-fence-recovery/v1';
const sha = value => createHash('sha256').update(value).digest('hex');
const refuse = reason => { throw new Error(`memory recovery fence refused: ${reason}`); };
const identity = st => Object.fromEntries(['dev', 'ino', 'uid', 'gid', 'mode', 'size',
  'birthtimeMs', 'mtimeMs', 'ctimeMs'].map(key => [key, st[key]]));

export function localBootIdentity() {
  // No caller-supplied boot time or environment override is accepted by the CLI.
  if (process.platform !== 'darwin') refuse('verified boot identity is currently supported only on macOS');
  const query = key => execFileSync('/usr/sbin/sysctl', ['-n', key],
    { encoding: 'utf8', timeout: 2000, maxBuffer: 4096 }).trim();
  const time = query('kern.boottime').match(/^\{ sec = (\d+), usec = (\d+) \}/);
  const bootId = query('kern.bootsessionuuid');
  if (!time || !/^[0-9a-f-]{36}$/i.test(bootId)) refuse('OS boot identity is unavailable');
  return { platform: 'darwin', bootId, bootTimeMs: Number(time[1]) * 1000 + Number(time[2]) / 1000 };
}

function pidGone(pid) {
  try { process.kill(pid, 0); return false; }
  catch (error) { return error?.code === 'ESRCH'; }
}

function canonicalParent(databasePath, io) {
  if (typeof databasePath !== 'string' || !path.isAbsolute(databasePath)
    || path.resolve(databasePath) !== databasePath || !databasePath.endsWith('.db'))
    refuse('a canonical absolute .db path is required');
  const parent = path.dirname(databasePath);
  if (io.realpathSync(parent) !== parent) refuse('database parent contains a symlink');
  const st = io.lstatSync(parent);
  if (!st.isDirectory() || st.uid !== process.getuid() || (st.mode & 0o022))
    refuse('database parent must be an owned directory without group/other write access');
}

function snapshot(databasePath, { io, readBoot, isPidGone }) {
  canonicalParent(databasePath, io);
  const boot = readBoot();
  if (boot?.platform !== 'darwin' || !/^[0-9a-f-]{36}$/i.test(boot.bootId || '')
    || !Number.isFinite(boot.bootTimeMs) || boot.bootTimeMs <= 0 || boot.bootTimeMs >= Date.now())
    refuse('invalid OS boot identity');
  const lock = databasePath + '.rsp-lock';
  const gate = lock + '.recovery';
  const fence = io.lstatSync(gate);
  if (!fence.isDirectory() || fence.isSymbolicLink() || fence.uid !== process.getuid()
    || (fence.mode & 0o777) !== 0o700 || fence.nlink !== 2 || io.readdirSync(gate).length)
    refuse('recovery fence must be an empty, owned, mode-0700 directory');
  const preboot = st => ['birthtimeMs', 'mtimeMs', 'ctimeMs'].every(key =>
    Number.isFinite(st[key]) && st[key] > 0 && st[key] < boot.bootTimeMs);
  if (!preboot(fence)) refuse('fence is not provably older than the current boot');
  let fd;
  try {
    const before = io.lstatSync(lock);
    if (!before.isFile() || before.isSymbolicLink() || before.uid !== process.getuid()
      || before.size < 1 || before.size > 4096 || !preboot(before))
      refuse('writer claim is not a bounded owned preboot regular file');
    fd = io.openSync(lock, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const st = io.fstatSync(fd);
    const buffer = Buffer.alloc(4097);
    const length = io.readSync(fd, buffer, 0, buffer.length, 0);
    if (length !== st.size) refuse('writer claim size changed while reading');
    const bytes = buffer.subarray(0, length);
    if (!isDeepStrictEqual(identity(st), identity(before))
      || !isDeepStrictEqual(identity(io.lstatSync(lock)), identity(before))) refuse('writer claim changed while reading');
    const claim = JSON.parse(bytes.toString('utf8'));
    if (!Number.isSafeInteger(claim?.pid) || claim.pid <= 0 || typeof claim.token !== 'string'
      || !claim.token.startsWith(`${claim.pid}:`) || !isPidGone(claim.pid)) refuse('writer PID is live or unproved');
    return { schema, databasePath, boot, fence: identity(fence),
      claim: { ...identity(st), sha256: sha(bytes), pid: claim.pid },
      lockSourceSha256: sha(MEMORY_LOCK_SOURCE) };
  } finally { if (fd !== undefined) io.closeSync(fd); }
}

// Exported for read-only review/fixtures. Production always uses the actual OS and filesystem.
export function inspectMemoryFence(databasePath, { io = fs, readBoot = localBootIdentity, isPidGone = pidGone } = {}) {
  return snapshot(databasePath, { io, readBoot, isPidGone });
}

function syncDirectory(io, directory) {
  const fd = io.openSync(directory, fs.constants.O_RDONLY);
  try { io.fsyncSync(fd); } finally { io.closeSync(fd); }
}

function writeReceipt(io, file, value) {
  const fd = io.openSync(file, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
  try { io.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); io.fsyncSync(fd); }
  finally { io.closeSync(fd); }
}

export function recoverMemoryFence(expected, { io = fs, readBoot = localBootIdentity,
  isPidGone = pidGone, underLock = withPatchMutationLock } = {}) {
  if (expected?.schema !== schema) refuse('reviewed expectation schema is required');
  const verify = () => {
    const current = snapshot(expected.databasePath, { io, readBoot, isPidGone });
    if (!isDeepStrictEqual(current, expected)) refuse('reviewed fence, claim, source or boot identity changed');
    return current;
  };
  verify(); // Refuse unsafe inputs before even creating the operator serialization lock.
  return underLock(() => {
    const current = verify();
    const gate = expected.databasePath + '.rsp-lock.recovery';
    const archive = gate + '-archive-' + randomUUID();
    io.mkdirSync(archive, { mode: 0o700 });
    const intent = { schema: 'rsp-memory-fence-recovery-receipt/v1', status: 'prepared',
      createdAt: new Date().toISOString(), operatorPid: process.pid, expected: current,
      archive, databaseOpened: false, claimModified: false, memoryHealthVerified: false };
    writeReceipt(io, path.join(archive, 'intent.json'), intent);
    syncDirectory(io, archive);
    syncDirectory(io, path.dirname(archive));
    verify(); // Recheck after durable intent, immediately before the only fence mutation.
    let renamed = false;
    try {
      io.renameSync(gate, path.join(archive, 'fence'));
      renamed = true;
      const moved = io.lstatSync(path.join(archive, 'fence'));
      if (!moved.isDirectory() || moved.isSymbolicLink() || moved.dev !== current.fence.dev
        || moved.ino !== current.fence.ino || moved.uid !== current.fence.uid
        || moved.gid !== current.fence.gid || moved.mode !== current.fence.mode
        || io.readdirSync(path.join(archive, 'fence')).length)
        refuse(`archive identity mismatch; preserve and review ${archive}`);
      syncDirectory(io, archive);
      syncDirectory(io, path.dirname(archive));
      const result = { ...intent, status: 'fence-archived', completedAt: new Date().toISOString(),
        next: 'Use native MCP; its existing lock owner must recover the unchanged dead claim. Verify exact memory read/write separately.' };
      writeReceipt(io, path.join(archive, 'result.json'), result);
      syncDirectory(io, archive);
      return result;
    } catch (error) {
      // An external, non-cooperating replacement or persistence failure is not approval.
      // Restore refusal exclusively; never overwrite/remove a successor's fence or claim.
      let refusalMarker = 'original-retained', restorationError = null;
      if (renamed) {
        try { io.mkdirSync(gate, { mode: 0o700 }); refusalMarker = 'created'; }
        catch (restore) {
          if (restore?.code === 'EEXIST') refusalMarker = 'successor-present';
          else { refusalMarker = 'unavailable'; restorationError = restore.message; }
        }
        try { syncDirectory(io, path.dirname(gate)); } catch { /* original failure remains explicit */ }
      }
      try { writeReceipt(io, path.join(archive, 'failure.json'), { ...intent,
        status: 'failed', failedAt: new Date().toISOString(), renamed, refusalMarker,
        restorationError, error: error.message }); } catch { /* keep durable intent */ }
      if (restorationError) throw new Error(`${error.message}; refusal marker could not be restored: ${restorationError}; review ${archive}`);
      throw error;
    }
  });
}

export function recoverMemoryFenceFile(file) {
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink() || st.size < 1 || st.size > 16384)
    refuse('expectation must be a bounded regular JSON file');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    if (!isDeepStrictEqual(identity(fs.fstatSync(fd)), identity(st))) refuse('expectation file changed');
    const buffer = Buffer.alloc(16385);
    const length = fs.readSync(fd, buffer, 0, buffer.length, 0);
    if (length !== st.size || !isDeepStrictEqual(identity(fs.fstatSync(fd)), identity(st))) refuse('expectation file changed');
    return recoverMemoryFence(JSON.parse(buffer.subarray(0, length).toString('utf8')));
  } finally { fs.closeSync(fd); }
}
