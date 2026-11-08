export const hooksPostTask = {
    name: 'hooks_post-task',
    description: 'Record task completion for learning Use when native Bash hooks (via Claude Code\'s settings.json) are wrong because you need Ruflo-side state — pattern persistence, neural training signals, model-routing learning, cost tracking, audit chain. For one-off shell commands, plain Bash hooks are fine.',
    inputSchema: {
        type: 'object',
        properties: {
            taskId: { type: 'string', description: 'Task identifier' },
            patterns: feedbackPatternsSchema,
            success: { type: 'boolean', description: 'Whether task was successful' },
            agent: { type: 'string', description: 'Agent that completed the task' },
            quality: { type: 'number', minimum: 0, maximum: 1, description: 'Quality score (0-1)' },
            task: { type: 'string', description: 'Task description text (used for learning keyword extraction)' },
            duration: { type: 'number', description: 'Observed task duration in milliseconds (used by pheromone-adaptive topology)' },
            latencyBudgetMs: { type: 'number', description: 'Latency budget used to normalize duration (default 60000ms)' },
            consensusAlignment: { type: 'number', description: 'Agreement with accepted swarm consensus in [0,1] (default quality)' },
            agentRole: { type: 'string', description: 'Role for role-local pheromone normalization (default agent)' },
            storeDecisions: { type: 'boolean', description: 'Also store routing decision in memory DB' },
            // ADR-147 P2: nested-subagent spawn-tree capture
            parentAgentId: { type: 'string', description: 'ID of the parent agent (from Claude Code\'s parent_agent_id OTel span tag / x-claude-code-parent-agent-id header). Omit for top-level work.' },
            depth: { type: 'number', description: 'Chain depth from root lead session (0 = lead, 1+ = subagent). Used by ADR-147 P3 depth-aware guardrail.' },
        },
        required: ['taskId'],
    },
    handler: async (params) => {
        const taskId = params.taskId;
        const success = params.success !== false;
        const agent = params.agent;
        if (params.quality !== undefined && (typeof params.quality !== 'number'
            || !Number.isFinite(params.quality) || params.quality < 0 || params.quality > 1)) {
            return { success: false, error: 'quality must be a finite number between 0 and 1' };
        }
        const quality = params.quality === undefined ? (success ? 0.85 : 0.3) : params.quality;
        const startTime = Date.now();
        let patterns;
        try {
            patterns = validateFeedbackPatterns(params.patterns);
        }
        catch (error) {
            return { success: false, error: error.message };
        }
        {
            const v = validateIdentifier(taskId, 'taskId');
            if (!v.valid)
                return { success: false, error: v.error };
        }
        if (agent) {
            const v = validateIdentifier(agent, 'agent');
            if (!v.valid)
                return { success: false, error: v.error };
        }
        // ADR-147 P2: validate spawn-tree lineage if provided
        const parentAgentId = params.parentAgentId;
        if (parentAgentId !== undefined) {
            const v = validateIdentifier(parentAgentId, 'parentAgentId');
            if (!v.valid)
                return { success: false, error: v.error };
        }
        const depthRaw = params.depth;
        let depth;
        if (depthRaw !== undefined && depthRaw !== null) {
            const n = Number(depthRaw);
            if (!Number.isInteger(n) || n < 0 || n > 32) {
                return { success: false, error: 'depth must be a non-negative integer ≤ 32' };
            }
            depth = n;
        }
        // Phase 3: Wire recordFeedback through bridge → LearningSystem + ReasoningBank
        let feedbackResult = null;
        try {
            const bridge = await import('../memory/memory-bridge.js');
            feedbackResult = await bridge.bridgeRecordFeedback({
                taskId,
                task: params.task || undefined,
                success,
                quality,
                agent,
                duration: params.duration || undefined,
                patterns,
                // ADR-147 P2: forward spawn-tree lineage so it lands in feedback + memory
                parentAgentId,
                depth,
            });
        }
        catch {
            // Bridge not available — continue with basic response
        }
        // Phase 3: Record causal edge (task → outcome)
        try {
            const bridge = await import('../memory/memory-bridge.js');
            await bridge.bridgeRecordCausalEdge({
                sourceId: taskId,
                targetId: `outcome-${taskId}`,
                relation: success ? 'succeeded' : 'failed',
                weight: quality,
            });
        }
        catch {
            // Non-fatal
        }
        // Record trajectory via intelligence module (SONA + ReasoningBank).
        // #3353: keep the observed result instead of discarding it.
        let trajectoryRecorded = false;
        try {
            const intelligence = await import('../memory/intelligence.js');
            trajectoryRecorded = (await intelligence.recordTrajectory([{ type: 'result', content: params.task || taskId, metadata: { success, agent, quality }, timestamp: Date.now() }], success ? 'success' : 'failure')) === true;
        }
        catch {
            // Intelligence module not available — non-fatal
        }
        // ADR-130 Phase 3: "reinforced-by" edge on task success.
        // Writes: context node → task pattern node (relation: "reinforced-by")
        //
        // #2961 — this used to be fire-and-forget (no `await` on the IIFE). That
        // was invisible from the long-running MCP server, where the process
        // stays alive long enough for the detached write to finish in the
        // background. But `hooks post-task` (CLI) is the exact same handler
        // invoked from a one-shot process that calls `process.exit(0)`
        // immediately after this action resolves (bin/cli.js, #1552) — the
        // still-pending dynamic `import(...)` + `insertGraphEdge()` call was
        // killed before its first tick, so the CLI form dropped this edge on
        // every single success, not intermittently. Await it — this is a
        // single fast DB write, not worth losing correctness on one call site
        // to save latency on the other.
        if (success) {
            try {
                const { insertGraphEdge } = await import('../memory/graph-edge-writer.js');
                const sessionCtxId = `task:${taskId}`;
                const patternId = `pattern:${taskId}`;
                await insertGraphEdge({
                    sourceId: sessionCtxId,
                    targetId: patternId,
                    relation: 'reinforced-by',
                    weight: quality,
                    confidence: quality,
                    lastReinforced: new Date().toISOString(),
                    metadata: { success, agent, taskId },
                });
            }
            catch { /* non-fatal */ }
        }
        // Persist routing outcome for runtime learning (file-based, always reliable)
        const taskText = params.task || '';
        const outcomeKeywords = extractKeywords(taskText);
        let outcomePersisted = false;
        // #3064 — the previous ad-hoc regex `/^[a-zA-Z0-9_-]+$/` silently dropped
        // colon-namespaced plugin agents (`ruflo-core:reviewer`, etc.) — i.e. every
        // Claude Code plugin agent. Colons are already allowed by the canonical
        // validateIdentifier() check on line 1456 above (IDENTIFIER_RE includes ':'
        // and '.'), so no additional charset gating is needed here.
        if (taskText && agent) {
            try {
                const outcomes = loadRoutingOutcomes();
                outcomes.push({
                    task: taskText,
                    agent,
                    success,
                    quality,
                    keywords: outcomeKeywords,
                    timestamp: new Date().toISOString(),
                });
                saveRoutingOutcomes(outcomes);
                outcomePersisted = true;
            }
            catch { /* non-critical */ }
        }
        // Optionally store in memory DB for cross-session vector retrieval
        if (params.storeDecisions && taskText && agent) {
            try {
                const storeFn = await getRealStoreFunction();
                if (storeFn) {
                    await storeFn({
                        key: `routing-decision:${taskId}`,
                        namespace: 'patterns',
                        value: JSON.stringify({ task: taskText, agent, success, quality, keywords: outcomeKeywords }),
                        tags: ['routing-decision'],
                    });
                }
            }
            catch { /* non-critical */ }
            // #2786 fix-2 — also mirror into the JSON memory store so
            // `getIntelligenceStatsFromMemory()` (which reads .claude-flow/memory/store.json
            // synchronously) counts this routing decision in the hooks_metrics dashboard.
            // The AgentDB write above is authoritative for cross-session retrieval; this
            // is just the counter surface the sync reader depends on.
            try {
                const key = `routing-decision:${taskId}`;
                const store = loadMemoryStore();
                store.entries[key] = {
                    key,
                    value: JSON.stringify({ task: taskText, agent, success, quality, keywords: outcomeKeywords }),
                    namespace: 'patterns',
                    createdAt: new Date().toISOString(),
                    metadata: { type: 'routing-decision', confidence: typeof quality === 'number' ? quality : undefined, agent, success },
                };
                const memDir = resolve(MEMORY_DIR);
                if (!existsSync(memDir))
                    mkdirSync(memDir, { recursive: true });
                writeFileSync(getMemoryPath(), JSON.stringify(store, null, 2), 'utf-8');
            }
            catch { /* non-critical */ }
        }
        let pheromone;
        if (agent) {
            try {
                const { recordSwarmPheromoneSignal } = await import('./swarm-tools.js');
                const observedDuration = Math.max(0, Number(params.duration ?? (Date.now() - startTime)));
                const latencyBudgetMs = Math.max(1, Number(params.latencyBudgetMs ?? 60_000));
                pheromone = recordSwarmPheromoneSignal({
                    agentId: agent,
                    role: String(params.agentRole ?? agent),
                    taskSuccess: success ? 1 : 0,
                    normalizedLatency: Math.max(0, Math.min(1, observedDuration / latencyBudgetMs)),
                    consensusAlignment: Math.max(0, Math.min(1, Number(params.consensusAlignment ?? quality))),
                });
            }
            catch { /* no active APSC swarm or optional path unavailable */ }
        }
        const duration = Date.now() - startTime;
        // Persist to auto-memory-store for statusline visibility
        try {
            const dataDir = join(getProjectCwd(), '.claude-flow', 'data');
            if (!existsSync(dataDir))
                mkdirSync(dataDir, { recursive: true });
            const storePath = join(dataDir, 'auto-memory-store.json');
            let store = [];
            try {
                if (existsSync(storePath)) {
                    const parsed = JSON.parse(readFileSync(storePath, 'utf-8'));
                    store = Array.isArray(parsed) ? parsed : [];
                }
            }
            catch { /* start fresh */ }
            store.push({
                id: `task-${taskId}`,
                key: taskId,
                content: `Task ${success ? 'completed' : 'failed'}: ${taskText || taskId}${agent ? ` (agent: ${agent})` : ''}`,
                namespace: 'tasks',
                type: 'task-outcome',
                metadata: { agent, success, quality },
                createdAt: Date.now(),
            });
            writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf-8');
        }
        catch { /* non-critical */ }
        // #3353: report only observed learning results. The previous
        // `feedbackResult?.updated || (success ? 2 : 1)` / `newPatterns: success ? 1 : 0`
        // invented counts whenever the feedback controller was unavailable (and the
        // `||` turned an observed 0 into 2). No path reports pattern *creation*, so
        // newPatterns is null (unknown) rather than a guess; the trajectory has no
        // real id to surface, so trajectoryId is null.
        const feedbackRecorded = feedbackResult?.success === true;
        const learningAvailable = feedbackRecorded;
        return {
            taskId,
            success,
            duration,
            learningUpdates: {
                patternsUpdated: feedbackRecorded ? (feedbackResult?.updated ?? 0) : 0,
                newPatterns: null,
                trajectoryId: null,
                controller: feedbackResult?.controller || 'none',
                outcomePersisted,
                available: learningAvailable,
                ...(learningAvailable ? {} : {
                    reason: feedbackResult
                        ? `feedback controller '${feedbackResult.controller}' did not record the outcome`
                        : 'feedback controller unavailable',
                }),
            },
            trajectory: { recorded: trajectoryRecorded },
            quality,
            pheromone,
            feedback: feedbackResult ? {
                recorded: feedbackResult.success,
                controller: feedbackResult.controller,
                updates: feedbackResult.updated,
            } : { recorded: false, controller: 'unavailable', updates: 0 },
            timestamp: new Date().toISOString(),
        };
    },
};
// Explain hook - transparent routing explanation
