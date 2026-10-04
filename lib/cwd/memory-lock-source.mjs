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
      return h;
    } catch (e) {
      if (e && e.code === 'RSP_MEMORY_LOCK_UNAVAILABLE') throw e;
      if (!e || e.code !== 'EEXIST')
        throw __rufloLockFailure(p, e && e.message ? e.message : String(e));
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
