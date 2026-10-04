export function runOutboxReplay({ projectDir, token = process.env.RUVNET_REPLAY_LOCK_TOKEN || null, budgetMs = DETACHED_REPLAY_BUDGET_MS,
  makeStoreFactory = boundedStoreFactory, now = Date.now, runCapture = runSessionSnapshotHook, onClaim = null,
  captureNormalized = captureNormalizedTransition, onCaptured = null } = {}) {
  const deadlineAt = now() + budgetMs;
  if (developmentHooksSuspended(projectDir)) return 0;
  const brainHome = process.env.RUVNET_BRAIN_HOME || path.join(os.homedir(), '.cache', 'ruvnet-brain');
  try {
    const consent = resolveTurnDb({ projectDir, brainHome });
    if (consent.skipped && !consent.skipped.startsWith('no project memory db')) return 0;
  } catch { return 0; }
  let held = token || takeReplayLock(projectDir);
  let replayed = 0;
  for (let round = 0; held && round < 8 && now() < deadlineAt; round += 1) {
    try {
      if (!adoptReplayLock(projectDir, held)) return replayed;
      reclaimOrphans(projectDir);
      const resolution = resolveProjectStore({ projectDir });
      const store = makeStoreFactory(deadlineAt)({ projectDir, requestedStorePath: resolution.canonicalAgentDbPath });
      for (const snapshot of store.outbox.pendingSnapshots()) {
        if (now() >= deadlineAt) return replayed;
        if (!refreshReplayLock(projectDir, held)) return replayed;
        store.outbox.markCommitted(store.appendExact(snapshot));
        replayed += 1;
      }
      for (const file of queuedCaptures(projectDir)) {
        if (now() >= deadlineAt) return replayed;
        if (!refreshReplayLock(projectDir, held)) return replayed;
        const claimed = claimQueued(file);
        if (!claimed) continue;
        onClaim?.(claimed);
        if (!refreshReplayLock(projectDir, held)) {
          returnClaim(claimed);
          return replayed;
        }
        let job = null;
        try { job = JSON.parse(fs.readFileSync(claimed, 'utf8')); } catch { /* torn: dropped below */ }
        let committed = false;
        try {
          if (job) {
            // Pre-upgrade raw queues lack origin identity and cannot be truthfully reconstructed.
            if (runCapture === runSessionSnapshotHook && (!job.originProjectDir || (!job.payload?.projectProgression && !job.payload?.normalizedTransition))) { returnClaim(claimed); return replayed; }
            const consent = resolveTurnDb({ projectDir: job.originProjectDir || projectDir, brainHome });
            if (developmentHooksSuspended(job.originProjectDir || projectDir)
              || (consent.skipped && !consent.skipped.startsWith('no project memory db'))) { returnClaim(claimed); return replayed; }
            const options = { rawInput: JSON.stringify(job.payload), host: job.host,
              budgetMs: Math.max(0, deadlineAt - now()), makeStoreFactory: () => makeStoreFactory(deadlineAt), now, ordered: held, writeMetadata: false,
              captureTurn: () => ({ recorded: false, skipped: 'detached replay' }),
              captureEvents: () => ({ recorded: 0, skipped: 'detached replay' }) };
            const result = job.payload?.normalizedTransition ? captureNormalized(job, options)
              : runCapture(job.originProjectDir || projectDir, job.event, options);
            committed = result?.progressionCaptured === true && Boolean(result.receipt);
            if (committed) onCaptured?.(result);
          }
        } catch { /* retain the queue until an exact-readback receipt exists */ }
        if (!committed) { returnClaim(claimed); return replayed; }
        try { fs.rmSync(claimed, { force: true }); } catch { /* best effort */ }
      }
    } catch { /* the debt stays durable; the next boundary hands it on again */ } finally {
      releaseReplayLock(projectDir, held);
    }
    held = now() < deadlineAt && queuedWork(projectDir) ? takeReplayLock(projectDir) : null;
  }
  if (held) releaseReplayLock(projectDir, held);
  return replayed;
}
