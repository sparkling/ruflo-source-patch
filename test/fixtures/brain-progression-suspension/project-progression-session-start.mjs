// Pristine ruvnet-brain@4.5.4 native function; dependencies supplied by the test.
export function restoreProgressionForSession({
  env = process.env,
  cwd = process.cwd(),
  storeFactory,
  maxOutputBytes = SESSION_CONTINUITY_LIMIT_BYTES,
  deadlineMs = SESSION_CONTINUITY_DEADLINE_MS,
  writable = (projectRoot) => {
    try { fs.accessSync(projectRoot, fs.constants.W_OK); return true; } catch { return false; }
  },
} = {}) {
  const projectDir = env.CLAUDE_PROJECT_DIR || cwd;
  let resolution;
  try {
    resolution = resolveProjectStore({ projectDir });
  } catch {
    return unknown('canonical-path');
  }

  if (!isProject(resolution)) return unavailable('non-project');
  if (!writable(resolution.projectRoot)) return unavailable('read-only');
  const initializing = !fs.existsSync(resolution.canonicalAgentDbPath);
  const rowCount = initializing ? 0 : committedRowCount(resolution.canonicalAgentDbPath);
  const miss = (reason) => unknown(reason, { rowCount });

  const prefix = `${RESTORED_HEADER}\n`;
  // Reserve room for the status prefix, the bounded-summary explanation, and any pending-outbox
  // notice appended after the payload. The final complete context is still checked below.
  const payloadLimit = maxOutputBytes - Buffer.byteLength(prefix, 'utf8') - 400;
  if (!Number.isSafeInteger(payloadLimit) || payloadLimit < 1) return miss('output-bound');

  let store;
  try {
    const deadlineAt = Date.now() + deadlineMs;
    const boundedRunner = (binary, args, options) => {
      const remaining = deadlineAt - Date.now();
      if (remaining < 1) throw new Error('restore deadline exceeded');
      const result = spawnSync(binary, args, { ...options, timeout: Math.min(options.timeout, remaining) });
      if (result.error) throw new Error('restore deadline exceeded');
      return result;
    };
    const makeStore = storeFactory ?? ((options) => new ProjectProgressionStore({
      ...options,
      env,
      runner: boundedRunner,
    }));
    store = makeStore({
      projectDir,
      requestedStorePath: resolution.canonicalAgentDbPath,
    });
    const home = env.HOME || env.USERPROFILE || os.homedir();
    const turns = replayTurnQueue({ projectDir, env, home, synchronous: true, runner: boundedRunner, deadlineMs: deadlineAt });
    if (turns.pending > 0 || turns.failed > 0) {
      const failed = miss('outbox-replay');
      return { ...failed, pendingTurns: turns.pending,
        context: `${failed.context} Durable turn recording remains pending; no older checkpoint was injected.` };
    }
    const suspended = ['persisted turn capture opt-out', 'turn capture policy unreadable or invalid'].includes(turns.skipped);
    if (turns.skipped && !suspended && !['RUVNET_TURN_CAPTURE=off',
      'no project memory db; persisted opt-in required'].includes(turns.skipped)) return miss('outbox-replay');
    if (suspended && initializing) return {
      status: 'unavailable', reason: 'capture-suspended', severity: 'info',
      context: '[RuvNet Brain — PROJECT CONTINUITY UNAVAILABLE]\nCapture consent suspends replay; no canonical store was created.',
    };
    if (suspended && (store.pendingReplayCount?.() > 0 || queuedWork(resolution.projectRoot) > 0)) {
      const failed = miss('outbox-replay');
      return { ...failed, context: `${failed.context} Replay is suspended by capture consent; no older checkpoint was injected.` };
    }
    if (initializing) {
      fs.mkdirSync(path.dirname(resolution.canonicalAgentDbPath), { recursive: true, mode: 0o700 });
      initializeCanonicalStore(store, resolution);
    }
    if (!suspended) {
      const queue = drainCaptureQueue({ projectDir, budgetMs: Math.max(0, deadlineAt - Date.now()),
        makeStoreFactory: () => () => store });
      if (queue.state !== 'settled') {
        const failed = miss('outbox-replay');
        return { ...failed, pendingReplay: queue.pending,
          context: `${failed.context} Durable capture work remains pending; no older checkpoint was injected.` };
      }
    }
    // A pending snapshot is newer observable work. Never label an older committed head restored
    // while that work remains unverified. Replay uses the same managed exact-readback store path.
    let restored;
    try {
      restored = store.restoreLatest({ maxOutputBytes: payloadLimit, replayPending: !suspended, projectToBound: true });
    } catch (error) {
      if (store.pendingReplayCount?.() > 0) {
        const failed = miss('outbox-replay');
        return { ...failed, pendingReplay: store.pendingReplayCount(),
          context: `${failed.context} ${store.pendingReplayCount()} durable snapshot(s) remain pending; no older checkpoint was injected.` };
      }
      throw error;
    }
    if (!validResume(restored)) return miss('malformed-store');
    const summaryNotice = restored.projected
      ? '\n[BOUNDED CONTINUITY SUMMARY] The merged current goal and next action are preserved exactly; '
        + 'a null value means the journal heads conflict. '
        + 'Other omitted details remain in the canonical AgentDB records; consult the listed head keys '
        + 'and omission digests. Omitted fields are marked and are not empty.'
      : '';
    const context = `${prefix}${summaryNotice}\n${restored.rendered}${pendingNotice(restored.pendingReplay)}`;
    if (Buffer.byteLength(context, 'utf8') > maxOutputBytes) return miss('output-bound');
    return {
      status: restored.projected ? 'restored-summary' : 'restored',
      severity: restored.projected ? 'warning' : 'info',
      degraded: restored.projected === true,
      pendingReplay: restored.pendingReplay,
      context,
    };
  } catch (error) {
    // A structurally enumerated, genuinely empty namespace is normal for a newly adopted project.
    if (/no coherent progression state/i.test(String(error?.message ?? ''))
      && Array.isArray(error?.rejectedCandidates) && error.rejectedCandidates.length === 0) {
      if (initializing && !fs.existsSync(resolution.canonicalAgentDbPath)) return miss('initialization-failed');
      const pending = pendingNotice(error?.pendingReplay);
      return {
        status: initializing ? 'initialized' : 'empty',
        severity: 'info',
        pendingReplay: error?.pendingReplay ?? 0,
        context: (initializing
          ? '[RuvNet Brain — PROJECT CONTINUITY INITIALIZED]\nThe canonical AgentDB store is ready; no prior progression snapshot exists yet.'
          : '[RuvNet Brain — PROJECT CONTINUITY EMPTY]\nThe canonical AgentDB store was structurally enumerated and contains no prior progression snapshot.')
          + pending,
      };
    }
    // NAME WHICH PATH RAN OUT OF TIME. "restore-failed" over a store full of rows tells the user
    // nothing they can act on; "the fast path was unavailable because <reason>, and the CLI fallback
    // is too slow for this deadline" tells them exactly what to fix.
    const readPath = typeof store?.lastReadPath === 'string' ? store.lastReadPath : '';
    if (/deadline exceeded/i.test(String(error?.message ?? '')) && readPath.startsWith('ruflo-cli')) {
      const missed = miss('fallback-too-slow');
      return { ...missed, context: `${missed.context} Read path: ${readPath}.` };
    }
    return miss(classify(error));
  }
}
