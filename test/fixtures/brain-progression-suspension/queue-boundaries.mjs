// Pristine ruvnet-brain@4.5.4; runOutboxReplay is reused from the collision fixture.
export function replayOutboxDetached({ projectDir, token = null, spawnFn = spawn } = {}) {
  const held = token || takeReplayLock(projectDir);
  if (!held) return false;
  try {
    const child = spawnFn(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'session-snapshot-hook.mjs'), '--replay-outbox'], {
      cwd: projectDir, detached: true, stdio: 'ignore', windowsHide: true,
      env: { ...process.env, RUVNET_REPLAY_LOCK_TOKEN: held },
    });
    child.unref?.();
    return true;
  } catch {
    releaseReplayLock(projectDir, held);
    return false;
  }
}
export function drainCaptureQueue({ projectDir, budgetMs = 1000, ...options } = {}) {
  const startedAt = Date.now();
  const resolution = resolveProjectStore({ projectDir, gitTimeoutMs: Math.max(1, Math.min(300, budgetMs)) });
  const root = resolution.projectRoot;
  const replayed = runOutboxReplay({ ...options, projectDir: root, budgetMs: Math.max(0, budgetMs - (Date.now() - startedAt)) });
  let outboxPending = 0;
  try { outboxPending = new ProgressionOutbox({ projectRoot: root }).pendingSnapshots().length; } catch { return { state: 'degraded', replayed, pending: null }; }
  const pending = queuedWork(root) + outboxPending;
  return { state: pending ? 'pending' : 'settled', replayed, pending };
}
