// Pristine ruvnet-brain@4.5.4 native function; dependencies supplied by the test.
export function runSessionSnapshotHook(projectDir, event, {
  rawInput = '',
  env = process.env,
  host = process.env.RUVNET_HOOK_HOST || 'claude',
  captureProgression = captureProjectTransition,
  produce = buildProjectProgression,
  budgetMs = effectiveBudgetMs(),
  now = Date.now,
  captureTurn = captureTurnOutcome,
  writeMetadata = true,
  makeStoreFactory = boundedStoreFactory,
  spawnReplay = replayOutboxDetached,
  ordered = null,
  captureEvents = captureContinuityEvents,
} = {}) {
  const suspended = (reason) => ({ metadataWritten: false, progressionCaptured: false, receipt: null, skipped: reason,
    turn: { event, recorded: false, skipped: reason }, continuity: { event, recorded: 0, launched: false, skipped: reason } });
  // Consent is checked before metadata, transcript inspection or any durable capture queue.
  try {
    const consent = resolveTurnDb({ projectDir, brainHome: env.RUVNET_BRAIN_HOME || path.join(env.HOME || os.homedir(), '.cache', 'ruvnet-brain'),
      gitTimeoutMs: Math.max(1, Math.min(500, budgetMs)) });
    if (consent.skipped) return suspended(consent.skipped);
  } catch (error) {
    return suspended(`capture consent unavailable: ${error.message}`);
  }
  // The detached worker re-runs a QUEUED boundary; its session receipt was already written then.
  const metadataWritten = writeMetadata ? writeSessionSnapshot(projectDir, event) : false;
  let payload;
  try { payload = rawInput ? JSON.parse(rawInput) : {}; } catch { payload = {}; }
  // TURN OUTCOMES FIRST: consent and canonical store availability govern whether a turn is queued
  // (a project without a store requires persisted opt-in — turn-outcome-capture.mjs).
  // It only reads and spawns a detached writer, so it costs the progression budget below nothing.
  let turn;
  try { turn = captureTurn({ projectDir, event, payload, host, env }); } catch (error) {
    turn = { recorded: false, skipped: `turn capture failed: ${error.message}` };
  }
  // MATERIAL EVENTS (continuity-journal.mjs): commits, releases, gates, findings, decisions, lessons —
  // journalled to the durable outbox with one fsync and committed by a detached drainer. Like turn
  // capture it is independent of the progression lock below and costs this boundary only a read.
  let continuity;
  try { continuity = captureEvents({ projectDir, event, payload, host, env }); } catch (error) {
    continuity = { recorded: 0, skipped: `continuity capture failed: ${error.message}` };
  }
  const idle = { metadataWritten, progressionCaptured: false, receipt: null, turn, continuity };

  if (hasProjectProgression(payload)) {
    if (payload.hook_event_name !== event) {
      throw new Error(`progression boundary mismatch: expected ${event}, received ${payload.hook_event_name}`);
    }
    const result = captureProgression({ host, payload, projectDir, storeFactory: (options) => makeStoreFactory(now() + budgetMs)({ ...options, env }) });
    return { ...idle, progressionCaptured: true, receipt: result.receipt };
  }

  // A payload with no session identity is not a real lifecycle event (an empty `{}` from a probe,
  // a malformed host). Capturing against an invented session id would fabricate a journal entry.
  if (typeof payload.session_id !== 'string' || !payload.session_id) {
    return { ...idle, skipped: 'no session identity in the host payload' };
  }

  let resolution;
  try { resolution = resolveProjectStore({ projectDir }); } catch {
    return { ...idle, skipped: 'project store could not be resolved' };
  }
  if (!fs.existsSync(path.dirname(resolution.canonicalAgentDbPath))) {
    return { ...idle, skipped: 'project has not adopted the canonical store' };
  }

  const root = resolution.projectRoot;
  const pendingCount = () => {
    try { return new ProgressionOutbox({ projectRoot: root }).pendingSnapshots().length; } catch { return 0; }
  };

  // CAUSAL ORDER. The producer links a new snapshot to the COMMITTED heads
  // (project-progression-producer.mjs), so a snapshot produced while older work is uncommitted would
  // not descend from it and the project would end with two unrelated heads
  // (tests/acceptance/cross-host-project-resume.test.mjs). "Older work" is BOTH the outbox (captures
  // interrupted after their fsync) AND the capture queue (whole boundaries waiting for a worker).
  //
  // THE REPLAY LOCK IS THE RIGHT TO COMMIT IN ORDER (4.4.0 re-review S-A). Every boundary takes it
  // before doing anything that commits. If it cannot — a live worker holds it — or older work is
  // queued, or (on a short budget) outbox debt cannot be replayed here, this boundary QUEUES itself
  // behind that work and the lock passes to a DETACHED, bounded worker that drains everything in
  // order. On Codex no boundary has the replay budget (Stop 3700ms effective, SessionEnd 1900ms, no
  // PreCompact). Any boundary, of any budget, therefore also drains a queue a dead worker stranded.
  // `ordered` is the worker's own re-entry: it already holds the lock and is draining in order.
  let token = ordered;
  const handOff = (why) => {
    let frozen;
    try { frozen = produce({ resolution, projectDir, payload, host, trigger: event }); } catch { frozen = null; }
    const queued = frozen?.projectProgression ? queueCapture({ projectDir: root, originProjectDir: projectDir, env, event, host,
      payload: { session_id: payload.session_id, hook_event_name: event, projectProgression: frozen.projectProgression } }) : null;
    const handed = queued ? spawnReplay({ projectDir: root, token }) : false;
    if (!handed && token && token !== ordered) releaseReplayLock(root, token);
    return { ...idle, replayed: 0, progressionCaptured: false, deferredToReplayer: Boolean(queued),
      replaySkipped: `${why}; this capture ${queued ? 'queued behind it' : 'NOT queued (queue unwritable)'}`
        + `${queued ? (handed ? ', handed to a detached worker' : ' (the current lock holder hands the queue to a worker when it releases)') : ''}` };
  };
  if (!ordered) {
    token = takeReplayLock(root);
    if (!token) return handOff('a worker is committing older work');
    const queuedAhead = queuedWork(root);
    if (queuedAhead) return handOff(`${queuedAhead} older capture(s) queued`);
    if (budgetMs < REPLAY_MIN_BUDGET_MS) {
      const pending = pendingCount();
      if (pending) return handOff(`outbox replay deferred: budget ${budgetMs}ms < ${REPLAY_MIN_BUDGET_MS}ms; ${pending} pending`);
    }
  }

  let handedLock = false;
  try {
    const deadlineAt = now() + budgetMs;
    const storeFactory = (options) => makeStoreFactory(deadlineAt)({ ...options, env });
    let replayed = 0;
    if (budgetMs >= REPLAY_MIN_BUDGET_MS) {
      try {
        replayed = storeFactory({ projectDir, requestedStorePath: resolution.canonicalAgentDbPath }).replay().length;
      } catch { /* the debt stays durable in the outbox; this capture is still worth attempting */ }
    }

    // Before COMMITTING anything, re-check the lock is still ours: with three racers, a stale-lock
    // put-back can leave a holder that no longer owns it. One that lost it queues itself instead.
    if (!ordered && !refreshReplayLock(root, token)) {
      token = null;
      handedLock = true;   // nothing of ours to release
      return handOff('the lock was taken over before this capture committed');
    }

    let produced;
    try {
      produced = produce({ resolution, projectDir, payload, host, trigger: event });
    } catch (error) {
      return { ...idle, replayed, skipped: `producer failed: ${error.message}` };
    }
    if (produced.skipped) return { ...idle, replayed, skipped: produced.skipped.reason };

    let result;
    try {
      result = captureProgression({
        host,
        payload: { ...payload, hook_event_name: event, projectProgression: produced.projectProgression },
        projectDir,
        storeFactory,
      });
    } catch (error) {
      // NOT LOST — DEFERRED. capture() fsyncs the snapshot to the durable outbox BEFORE it writes to
      // the store, so a budget overrun leaves the evidence on disk. On a short budget nothing later in
      // this process can settle it, so the lock goes straight to a detached worker.
      handedLock = !ordered && budgetMs < REPLAY_MIN_BUDGET_MS && pendingCount() > 0 && spawnReplay({ projectDir: root, token });
      return { ...idle, replayed, skipped: `capture deferred: ${error.message}`,
        ...(handedLock ? { replaySkipped: 'deferred capture handed to a detached worker' } : {}) };
    }
    return {
      metadataWritten,
      progressionCaptured: true,
      turn,
      continuity,
      replayed,
      receipt: result.receipt,
      provenance: produced.provenance,
    };
  } finally {
    // A boundary that fired while this one held the lock queued itself and could not start a worker
    // (this lock was in the way). Releasing without looking stranded it until the next boundary — two
    // simultaneous SessionEnds lost the second one's final state (4.4.1). So: queued work → hand THIS
    // lock to a worker; and re-check after releasing, for a boundary that queued in between.
    if (!ordered && !handedLock) {
      if (!(queuedWork(root) && spawnReplay({ projectDir: root, token }))) {
        releaseReplayLock(root, token);
        if (queuedWork(root)) spawnReplay({ projectDir: root });
      }
    }
  }
}
