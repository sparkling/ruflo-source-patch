const NATIVE_ID_BODY = '[a-zA-Z0-9_][a-zA-Z0-9_.:-]{0,127}';
const NATIVE_ID_RESERVED = ['__proto__', 'constructor', 'prototype'];
const NATIVE_ID_RULES = '1-128 chars of A-Z a-z 0-9 _ - . : (first char alphanumeric or _); not __proto__, constructor or prototype. Must be a registered native ID, not a host path such as /root/x.';
const nativeIdSchema = (description, opts = {}) => ({
    type: 'string',
    ...(opts.emptyMeansOmitted ? {} : { minLength: 1 }),
    maxLength: 128,
    pattern: opts.emptyMeansOmitted ? `^(?:${NATIVE_ID_BODY})?$` : `^${NATIVE_ID_BODY}$`,
    not: { enum: NATIVE_ID_RESERVED },
    description: `${description} ${NATIVE_ID_RULES}`,
});
export const hooksPostTask = {
    name: 'hooks_post-task',
    description: 'Record task completion for learning Use when native Bash hooks (via Claude Code\'s settings.json) are wrong because you need Ruflo-side state — pattern persistence, neural training signals, model-routing learning, cost tracking, audit chain. For one-off shell commands, plain Bash hooks are fine.',
    inputSchema: {
        type: 'object',
        properties: {
            taskId: nativeIdSchema('Task identifier.'),
            patterns: feedbackPatternsSchema,
            success: { type: 'boolean', description: 'Whether task was successful' },
            agent: nativeIdSchema('Agent that completed the task. An empty string is treated as omitted.', { emptyMeansOmitted: true }),
            quality: { type: 'number', minimum: 0, maximum: 1, description: 'Quality score (0-1)' },
            task: { type: 'string', description: 'Task description text (used for learning keyword extraction)' },
            duration: { type: 'number', description: 'Observed task duration in milliseconds (used by pheromone-adaptive topology)' },
            latencyBudgetMs: { type: 'number', description: 'Latency budget used to normalize duration (default 60000ms)' },
            consensusAlignment: { type: 'number', description: 'Agreement with accepted swarm consensus in [0,1] (default quality)' },
            agentRole: { type: 'string', description: 'Role for role-local pheromone normalization (default agent)' },
            storeDecisions: { type: 'boolean', description: 'Also store routing decision in memory DB' },
            // ADR-147 P2: nested-subagent spawn-tree capture
            parentAgentId: nativeIdSchema('ID of the parent agent (from Claude Code\'s parent_agent_id OTel span tag / x-claude-code-parent-agent-id header). Omit for top-level work.'),
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
