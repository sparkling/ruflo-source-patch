// Exact native functions from CLI 3.71.4; isolated by the test VM.

class LocalReasoningBank {
    flushToDisk() {
        if (!this.persistenceEnabled || !this.dirty)
            return;
        try {
            ensureDataDir();
            const path = getPatternsPath();
            writeFileSync(path, JSON.stringify(this.patternList, null, 2), 'utf-8');
            this.dirty = false;
        }
        catch (error) {
            // Log but don't throw - persistence failures shouldn't break training
            console.error('Failed to persist patterns:', error);
        }
    }
}

export async function recordTrajectory(steps, verdict) {
    if (!sonaCoordinator) {
        const init = await initializeIntelligence();
        if (!init.success)
            return false;
    }
    try {
        // Generate embeddings for steps that don't have them (required for distillation)
        const enrichedSteps = await Promise.all(steps.map(async (step) => {
            if (step.embedding && step.embedding.length > 0)
                return step;
            try {
                const { generateEmbedding } = await import('./memory-initializer.js');
                const result = await generateEmbedding(step.content);
                return { ...step, embedding: result.embedding };
            }
            catch {
                return step; // Skip embedding if not available
            }
        }));
        sonaCoordinator.recordTrajectory({
            steps: enrichedSteps,
            verdict,
            timestamp: Date.now()
        });
        // Apply RL: update pattern confidences based on verdict
        if (reasoningBank) {
            for (const step of enrichedSteps) {
                sonaCoordinator.addTrajectoryStep(step);
            }
            await sonaCoordinator.endTrajectory(verdict, reasoningBank);
            await sonaCoordinator.distillLearning(reasoningBank);
            // Also store successful trajectories as patterns directly
            if (verdict === 'success') {
                for (const step of enrichedSteps) {
                    if (step.embedding && step.embedding.length > 0) {
                        const added = reasoningBank.store({
                            id: `pattern-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                            type: step.type,
                            content: step.content,
                            embedding: step.embedding,
                            confidence: verdict === 'success' ? 0.8 : 0.4,
                            metadata: step.metadata || {},
                            createdAt: Date.now(),
                        });
                        // #3979 item 4: count only patterns that were actually added. A step
                        // whose content already exists is merged into that pattern, so the
                        // counter no longer climbs once per successful step.
                        if (added)
                            bumpStat('patternsLearned');
                    }
                }
            }
        }
        // Forward trajectory to @ruvector/ruvllm SonaCoordinator if available
        const ruvllmCoord = await loadRuvllmCoordinator();
        if (ruvllmCoord) {
            try {
                const avgQuality = verdict === 'success' ? 1.0 : verdict === 'partial' ? 0.5 : 0.0;
                ruvllmCoord.recordTrajectory({
                    steps: enrichedSteps.map(s => ({
                        type: ['query', 'route', 'generate', 'memory', 'feedback'].includes(s.type)
                            ? s.type : 'generate',
                        input: s.content,
                        output: '',
                        durationMs: 0,
                        confidence: avgQuality
                    })),
                    totalReward: avgQuality,
                    outcome: verdict
                });
            }
            catch {
                // ruvllm recording failed silently
            }
        }
        bumpStat('trajectoriesRecorded');
        globalStats.lastAdaptation = Date.now();
        // #4283: the bank's own save is debounced, and the one-shot bins exit as
        // soon as the command resolves, so write the patterns now. Otherwise
        // stats.json counts patterns that never reach patterns.json.
        reasoningBank?.flushToDisk();
        savePersistedStats();
        return true;
    }
    catch {
        return false;
    }
}

export function getIntelligenceStats() {
    const sonaStats = sonaCoordinator?.stats();
    const bankStats = reasoningBank?.stats();
    // Lazy-init the ruvllm coordinator if it hasn't been loaded yet. The MCP
    // dashboard (`hooks_intelligence_stats`) hits this path before any
    // initializeIntelligence() call has fired, so the coordinator field would
    // otherwise stay null and the dashboard would report "unavailable" even
    // when @ruvector/ruvllm is fully resolvable. Sync require — cheap, idempotent.
    if (!ruvllmLoaded) {
        loadRuvllmCoordinatorSync();
    }
    // A read-only status process (ruvllm_status, `neural status`, a fresh MCP
    // server) has never run initializeIntelligence(); without this it reported
    // 0 trajectories no matter what other processes had persisted.
    if (!persistedStatsLoaded) {
        loadPersistedStats();
    }
    const ruvllmStats = ruvllmCoordinator?.stats?.() || null;
    // Fetch cross-module stats for unified reporting.
    //
    // #2549 — two prior defects here: `trainingBackend` was declared and
    // returned but never assigned (always 'unavailable'), and contrastive
    // availability was read ONLY from an in-process global that a fresh
    // read-only `neural status` process never populates. Both made the
    // native @ruvector/ruvllm path invisible even when installed. Backend
    // now comes from the lora-adapter's capability probe; the global still
    // wins when present because it carries live in-process session counts.
    let contrastiveTrainer = 'unavailable';
    let trainingBackend = 'unavailable';
    try {
        trainingBackend = resolveTrainingBackend();
    }
    catch { /* module absent — stay 'unavailable' */ }
    try {
        const sonaModule = globalThis.__claudeFlowSonaStats;
        if (sonaModule?._contrastiveTrainer) {
            contrastiveTrainer = sonaModule._contrastiveTrainer;
        }
        else if (trainingBackend === 'ruvllm') {
            // Module resolves but no in-process session — available, idle.
            contrastiveTrainer = 'available';
        }
    }
    catch { /* not available */ }
    return {
        sonaEnabled: !!sonaCoordinator,
        reasoningBankSize: bankStats?.size ?? 0,
        patternsLearned: Math.max(bankStats?.patternCount ?? 0, globalStats.patternsLearned),
        signalsProcessed: globalStats.signalsProcessed,
        trajectoriesRecorded: globalStats.trajectoriesRecorded,
        lastAdaptation: globalStats.lastAdaptation,
        avgAdaptationTime: sonaStats?.avgAdaptationMs ?? 0,
        _ruvllmBackend: ruvllmStats ? 'active' : 'unavailable',
        _ruvllmTrajectories: ruvllmStats?.trajectoriesBuffered || 0,
        _contrastiveTrainer: contrastiveTrainer,
        _trainingBackend: trainingBackend,
    };
}

export function getPersistenceStatus() {
    const dataDir = getDataDir();
    const patternsFile = getPatternsPath();
    const statsFile = getStatsPath();
    return {
        enabled: true,
        dataDir,
        patternsFile,
        statsFile,
        patternsExist: existsSync(patternsFile),
        statsExist: existsSync(statsFile)
    };
}
