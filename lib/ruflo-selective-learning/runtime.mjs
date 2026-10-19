// Related manual-learning integration: ruvnet/ruflo#2245. This does not repair
// global SONA buffers or claim EWC/provider-weight training.
export async function learnSelectedTrajectories(params, owner) {
  if (!params || !Array.isArray(params.trajectoryIds) || !params.trajectoryIds.length
      || params.trajectoryIds.length > 32 || new Set(params.trajectoryIds).size !== params.trajectoryIds.length
      || params.trajectoryIds.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id))
      || (params.consolidate !== undefined && typeof params.consolidate !== 'boolean'))
    throw Error('Select 1..32 distinct valid trajectoryIds; consolidate must be boolean');
  const { rb, getEntry, hash, dbPath, guard } = owner;
  const progress = owner.progress ?? { entries: [], mutationAttempted: false };
  if (!rb || rb.vectorBackend || !['searchPatterns', 'storePattern', 'getPattern'].every(k => typeof rb[k] === 'function'))
    throw Error('Qualified native ReasoningBank legacy pattern APIs required');
  const plan = [];
  // Validate the complete requested batch before any write. No pending records,
  // truncated summaries, invented success, synthetic replay or global fallback.
  for (const id of params.trajectoryIds) {
    const key = `trajectory-${id}`;
    const found = await getEntry({ namespace: 'trajectories', key });
    const raw = found?.entry?.content;
    if (found?.success !== true || found.found !== true || typeof raw !== 'string')
      throw Error(`Completed trajectory not found: ${id}`);
    const value = JSON.parse(raw);
    if (value?.id !== id || typeof value.task !== 'string' || !value.task.trim()
        || typeof value.agent !== 'string' || typeof value.success !== 'boolean'
        || !Number.isFinite(Date.parse(value.startedAt)) || !Number.isFinite(Date.parse(value.endedAt))
        || Date.parse(value.endedAt) < Date.parse(value.startedAt)
        || !Array.isArray(value.steps) || !value.steps.length
        || !value.steps.every(s => s && typeof s.action === 'string' && typeof s.result === 'string'
          && typeof s.quality === 'number' && Number.isFinite(s.quality) && s.quality >= 0 && s.quality <= 1
          && typeof s.timestamp === 'string' && Number.isFinite(Date.parse(s.timestamp))))
      throw Error(`Invalid or unfinished source trajectory: ${id}`);
    const sourceSha256 = hash(raw);
    const taskType = `selected-trajectory:${id}`;
    const matches = await rb.searchPatterns({ task: value.task, k: 2, threshold: -1,
      filters: { taskType } });
    if (!Array.isArray(matches) || matches.some(p => p.taskType !== taskType) || matches.length > 1)
      throw Error(`Ambiguous native selected-pattern identity: ${id}`);
    let existing = null;
    if (matches.length) {
      existing = rb.getPattern(matches[0].id);
      if (existing?.approach !== raw || existing.metadata?.sourceSha256 !== sourceSha256
          || existing.metadata?.sourceKey !== key || existing.metadata?.sourceDbPath !== dbPath
          || existing.successRate !== Number(value.success))
        throw Error(`Changed source or conflicting selected-pattern identity: ${id}`);
    }
    plan.push({ id, key, raw, value, sourceSha256, taskType, existing });
  }
  const entries = [];
  for (const item of plan) {
    let pattern = item.existing;
    if (!pattern) {
      await guard(item.id);
      // Re-read immediately before mutation: corrections must not be learned
      // under an old hash. The caller must explicitly assess changed originals.
      const fresh = await getEntry({ namespace: 'trajectories', key: item.key });
      if (fresh?.success !== true || fresh.entry?.content !== item.raw)
        throw Error(`Source changed during selected learning: ${item.id}`);
      progress.mutationAttempted = true;
      const patternId = await rb.storePattern({ taskType: item.taskType, approach: item.raw,
        successRate: Number(item.value.success), uses: 1,
        ...(Number.isFinite(item.value.reward) ? { avgReward: item.value.reward } : {}),
        tags: ['selected-trajectory', item.value.success ? 'observed-success' : 'observed-failure'],
        metadata: { sourceNamespace: 'trajectories', sourceKey: item.key, sourceTrajectoryId: item.id,
          sourceDbPath: dbPath, sourceSha256: item.sourceSha256,
          sourceStartedAt: item.value.startedAt, sourceEndedAt: item.value.endedAt,
          learningMethod: 'complete-evaluated-trajectory-pattern-retention-v1',
          metrics: { successRateBasis: 'one recorded Boolean task outcome; not accuracy or quality uplift',
            observedOutcomes: 1, sourceReward: Number.isFinite(item.value.reward) ? item.value.reward : null,
            sourceRewardStatus: Number.isFinite(item.value.reward) ? 'preserved-in-source-and-metadata' : 'unavailable',
            nativeAvgRewardDefault: Number.isFinite(item.value.reward) ? null : 'controller default, not an observed reward' } } });
      pattern = rb.getPattern(patternId);
      if (pattern?.approach !== item.raw || pattern.metadata?.sourceSha256 !== item.sourceSha256
          || pattern.successRate !== Number(item.value.success))
        throw Error(`Selected pattern exact readback failed: ${item.id}`);
    }
    entries.push({ trajectoryId: item.id, sourceKey: item.key, sourceSha256: item.sourceSha256,
      patternId: String(pattern.id), alreadyLearned: !!item.existing,
      outcome: item.value.success, preservedSourceBytes: Buffer.byteLength(item.raw) });
    progress.entries = [...entries];
  }
  return { success: true, learned: entries.some(e => !e.alreadyLearned), cycleTriggered: false,
    retentionChecked: true,
    operation: 'selected-completed-trajectory-pattern-retention', controller: 'reasoningBank', dbPath,
    patternsLearned: entries.filter(e => !e.alreadyLearned).length,
    alreadyLearned: entries.filter(e => e.alreadyLearned).length, entries,
    backgroundLearningRun: false, sourceTrajectoryReplay: false,
    ewc: { requested: params.consolidate !== false, ran: false,
      reason: 'Scoped pattern retention does not train SONA weights or run global EWC' },
    concurrency: 'requests serialized within this native owner; no cross-process atomic reconcile claim' };
}

export const BRIDGE_RUNTIME = `// ruflo-source-patch (#2245 selected-learning)
${learnSelectedTrajectories.toString()}
let rspSelectedLearningQueue = Promise.resolve();
export async function bridgeLearnSelectedTrajectories(params) {
    if (!operationContext.getStore()?.active)
        return withBridgeOperation(() => bridgeLearnSelectedTrajectories(params));
    const progress = { entries: [], mutationAttempted: false };
    const run = rspSelectedLearningQueue.then(async () => {
        const registry = await getRegistry();
        if (!registry) throw Error('Native AgentDB registry unavailable');
        return learnSelectedTrajectories(params, {
            rb: registry.get('reasoningBank'), dbPath: registry.dbPath, progress,
            hash: raw => crypto.createHash('sha256').update(raw, 'utf8').digest('hex'),
            getEntry: options => bridgeGetEntry(options),
            guard: async id => {
                const verdict = await guardValidate(registry, 'store', { key: id, namespace: 'reasoning-patterns' });
                if (!verdict.allowed) throw Error('Native selected-learning mutation guard refused');
            },
        });
    });
    rspSelectedLearningQueue = run.catch(() => {});
    try { return await run; }
    catch (error) { return { success: false, learned: progress.mutationAttempted ? null : false,
        status: progress.mutationAttempted ? 'partial-or-unconfirmed' : 'refused-before-write',
        mutationAttempted: progress.mutationAttempted, verifiedEntries: progress.entries,
        error: error.message, backgroundLearningRun: false, cycleTriggered: false }; }
}
`;
