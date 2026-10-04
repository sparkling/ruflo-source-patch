// Shared owner-safe memory lock fragment: issue #2878, ADR-023.
export const MEMORY_LOCK_SOURCE = `const { AsyncLocalStorage: __rufloAsyncLocalStorage } = __rufloReq('node:async_hooks');
const __rufloLockScope = new __rufloAsyncLocalStorage();
const __rufloActiveLocks = new Map();
function __rufloLockFailure(p, why) {
  const e = new Error('[ruflo-source-patch] REFUSING memory.db operation for ' + String(p) + ': cross-process write lock unavailable (' + why + '). The operation did not run; retry after the current writer exits or repair the lock path. Proceeding unlocked would acknowledge silent data loss (ruflo#2878).');
  e.code = 'RSP_MEMORY_LOCK_UNAVAILABLE';
  return e;
}
function __rufloLockOwned(h, nfs) {
  if (!h) return false;
  try {
    const fdStat = nfs.fstatSync(h.fd);
    const pathStat = nfs.lstatSync(h.lockFile);
    if (fdStat.dev !== pathStat.dev || fdStat.ino !== pathStat.ino) return false;
    const claim = JSON.parse(nfs.readFileSync(h.lockFile, 'utf8'));
    return claim && claim.token === h.token && claim.pid === process.pid;
  } catch { return false; }
}
function __rufloPidGone(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return false; }
  catch (e) { return e && e.code === 'ESRCH'; }
}
function __rufloRecoveryFencePresent(lockFile, nfs) {
  try { nfs.lstatSync(lockFile + '.recovery'); return true; }
  catch (e) { return !e || e.code !== 'ENOENT'; }
}
function __rufloRecoverDeadClaim(lockFile, nfs) {
  // Only recovery contenders use this exclusive directory. Ordinary old clients never
  // steal claims, and cannot create a successor until the existing claim is renamed.
  // A crash in this synchronous recovery section leaves the directory and fails closed.
  const gate = lockFile + '.recovery';
  let gateStat, fd;
  try {
    nfs.mkdirSync(gate, { mode: 0o700 });
    gateStat = nfs.lstatSync(gate);
    fd = nfs.openSync(lockFile, nfs.constants.O_RDONLY | (nfs.constants.O_NOFOLLOW || 0));
    const st = nfs.fstatSync(fd);
    if (!st.isFile() || st.size < 1 || st.size > 4096) return false;
    const text = nfs.readFileSync(fd, 'utf8');
    const claim = JSON.parse(text);
    if (!claim || typeof claim.token !== 'string'
      || !claim.token.startsWith(String(claim.pid) + ':') || !__rufloPidGone(claim.pid)) return false;
    const current = nfs.lstatSync(lockFile);
    if (!current.isFile() || current.isSymbolicLink() || st.dev !== current.dev || st.ino !== current.ino
      || nfs.readFileSync(lockFile, 'utf8') !== text || !__rufloPidGone(claim.pid)) return false;
    // Preserve the exact ownership evidence. Never unlink a claim by an unguarded
    // liveness guess, and never rename/modify database files or SQLite sidecars.
    const archive = lockFile + '.dead-' + process.pid + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    nfs.renameSync(lockFile, archive);
    const moved = nfs.lstatSync(archive);
    if (moved.dev !== st.dev || moved.ino !== st.ino || nfs.readFileSync(archive, 'utf8') !== text) {
      // External replacement is outside the cooperating recovery protocol. Restore
      // only if absent; a successor's ownership is never overwritten or removed.
      try { nfs.linkSync(archive, lockFile); } catch {}
      return false;
    }
    return true;
  } catch { return false; }
  finally {
    try { if (fd !== undefined) nfs.closeSync(fd); } catch {}
    try {
      const current = nfs.lstatSync(gate);
      if (gateStat && current.dev === gateStat.dev && current.ino === gateStat.ino) nfs.rmdirSync(gate);
    } catch { /* unknown or nonempty recovery gates stay fail-closed */ }
  }
}
async function __rufloLockAcquire(p) {
  if (!p || typeof p !== 'string') throw __rufloLockFailure(p, 'database path is unresolved');
  let nfs;
  try { nfs = __rufloReq('fs'); }
  catch { throw __rufloLockFailure(p, 'filesystem module is unavailable'); }
  const lockFile = p + '.rsp-lock';
  const token = process.pid + ':' + Date.now().toString(36) + ':' + Math.random().toString(36).slice(2);
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      if (__rufloRecoveryFencePresent(lockFile, nfs)) {
        if (Date.now() > deadline) throw __rufloLockFailure(p, 'recovery fence unavailable: ' + lockFile + '.recovery');
        await new Promise((r) => setTimeout(r, 20));
        continue;
      }
      const fd = nfs.openSync(lockFile, nfs.constants.O_CREAT | nfs.constants.O_EXCL | nfs.constants.O_WRONLY, 0o600);
      const h = { fd, lockFile, token };
      try {
        nfs.writeSync(fd, JSON.stringify({ pid: process.pid, token }));
        nfs.fsyncSync(fd);
      }
      catch (e) {
        try { if (__rufloLockOwned(h, nfs)) nfs.unlinkSync(lockFile); } catch {}
        try { nfs.closeSync(fd); } catch {}
        throw __rufloLockFailure(p, 'could not record lock ownership: ' + (e && e.message ? e.message : String(e)));
      }
      __rufloActiveLocks.set(p, h);
      if (__rufloRecoveryFencePresent(lockFile, nfs)) {
        __rufloLockRelease(p, h);
        await new Promise((r) => setTimeout(r, 20));
        continue;
      }
      return h;
    } catch (e) {
      if (e && e.code === 'RSP_MEMORY_LOCK_UNAVAILABLE') throw e;
      if (!e || e.code !== 'EEXIST')
        throw __rufloLockFailure(p, e && e.message ? e.message : String(e));
      if (__rufloRecoverDeadClaim(lockFile, nfs)) continue;
      if (Date.now() > deadline) throw __rufloLockFailure(p, 'timed out after 5s: ' + lockFile);
      await new Promise((r) => setTimeout(r, 15 + Math.floor(Math.random() * 25)));
    }
  }
}
function __rufloLockRelease(p, h) {
  if (!h) return;
  __rufloActiveLocks.delete(p);
  let nfs;
  try { nfs = __rufloReq('fs'); } catch { return; }
  const owned = __rufloLockOwned(h, nfs);
  try { if (owned) nfs.unlinkSync(h.lockFile); } catch {}
  try { nfs.closeSync(h.fd); } catch {}
}
async function __rufloWithLock(p, fn) {
  const held = __rufloLockScope.getStore();
  const inherited = held && held.get(p);
  if (inherited && __rufloActiveLocks.get(p) === inherited) return fn();
  const h = await __rufloLockAcquire(p);
  const next = new Map(held || []);
  next.set(p, h);
  return __rufloLockScope.run(next, async () => {
    try { return await fn(); }
    finally { __rufloLockRelease(p, h); }
  });
}
function __rufloReleaseOwnedLocks() {
  for (const [p, h] of [...__rufloActiveLocks]) __rufloLockRelease(p, h);
}
try {
  process.on('exit', __rufloReleaseOwnedLocks);
  for (const signal of ['SIGTERM', 'SIGINT']) {
    // A native shutdown handler owns its lifetime; never unlock while it drains work.
    // Delegation is permanent: later once/removal restores the OS default, not a no-op.
    if (process.listenerCount(signal)) continue;
    let delegated = false;
    const onNativeListener = (event, listener) => {
      if (event !== signal || listener === onSignal) return;
      delegated = true;
      // newListener fires BEFORE registration. Removing the last signal listener there
      // closes Node's OS handle before the native handler attaches; detach afterwards.
      queueMicrotask(() => {
        process.removeListener(signal, onSignal);
        process.removeListener('newListener', onNativeListener);
      });
    };
    const onSignal = () => {
      if (delegated) return;
      __rufloReleaseOwnedLocks();
      process.removeListener(signal, onSignal);
      process.removeListener('newListener', onNativeListener);
      // Re-deliver with our sole handler removed, preserving default signal termination.
      process.kill(process.pid, signal);
    };
    process.on(signal, onSignal);
    process.on('newListener', onNativeListener);
  }
} catch { /* no process hook available */ }`;
