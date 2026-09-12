// ruvnet/ruflo#3314: adapt explicit episodes, never manufacture outcomes from facts.
// Scope: the observed 3.41.2 bridge function, not storage or hierarchy semantics.
// Retire only after upstream proves both recall forms, eligibility reporting,
// preserved MemoryPattern fields and honest failure paths; unknown bytes fail closed.
export const CONTEXT_OLD = `export async function bridgeContextSynthesize(params) {
    const registry = await getRegistry();
    if (!registry)
        return null;
    try {
        const CS = registry.get('contextSynthesizer');
        if (!CS || typeof CS.synthesize !== 'function') {
            return { success: false, error: 'ContextSynthesizer not available' };
        }
        // Gather memory patterns from hierarchical memory as input
        const hm = registry.get('hierarchicalMemory');
        let memories = [];
        if (hm && typeof hm.recall === 'function') {
            // Detect real HierarchicalMemory (MemoryQuery object) vs stub (string, number)
            let recalled;
            if (typeof hm.promote === 'function') {
                // Real agentdb HierarchicalMemory
                recalled = await hm.recall({ query: params.query, k: params.maxEntries || 10 });
            }
            else {
                // Stub
                recalled = hm.recall(params.query, params.maxEntries || 10);
            }
            memories = (recalled || []).map((r) => ({
                content: r.value || r.content || '',
                key: r.key || r.id || '',
                reward: 1,
                verdict: 'success',
            }));
        }
        const result = CS.synthesize(memories, { includeRecommendations: true });
        return { success: true, synthesis: result };
    }
    catch (e) {
        return { success: false, error: e.message };
    }
}`;

export const CONTEXT_NEW = String.raw`export async function bridgeContextSynthesize(params) {
    // ruflo-source-patch (#3314): explicit MemoryPattern data only; no writes.
    const inputContract = 'validated-memory-pattern-v1';
    const counts = { recalledCount: null, eligibleCount: null, excludedCount: null };
    let phase = 'input';
    const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const own = (value, key) => isObject(value) ? Object.getOwnPropertyDescriptor(value, key) : undefined;
    function pattern(value) {
        const task = own(value, 'task');
        const reward = own(value, 'reward');
        const success = own(value, 'success');
        if (![task, reward, success].every(field => field && Object.hasOwn(field, 'value'))
            || typeof task.value !== 'string' || !task.value.trim()
            || !Number.isFinite(reward?.value) || typeof success?.value !== 'boolean') return null;
        const out = { task: task.value, reward: reward.value, success: success.value };
        for (const name of ['critique', 'input', 'output', 'similarity']) {
            const field = own(value, name);
            if (!field) continue;
            if (!Object.hasOwn(field, 'value')) return null;
            if (field.value === undefined) continue;
            if (name === 'similarity' ? !Number.isFinite(field.value) : typeof field.value !== 'string') return null;
            out[name] = field.value;
        }
        return out;
    }
    function payload(value) {
        if (typeof value !== 'string') return pattern(value);
        // Hierarchical values may be JSON strings. Bound decoding to 64 KiB;
        // accept a complete JSON object, not prose, fenced JSON or JSON fragments.
        if (value.length > 65536 || Buffer.byteLength(value, 'utf8') > 65536) return null;
        let parsed;
        try { parsed = JSON.parse(value); } catch { return null; }
        if (!isObject(parsed)) return null;
        // JSON.parse accepts duplicate keys by overwriting evidence. Reject even
        // escaped duplicate top-level names; quoted braces/colons are not keys.
        const keys = new Set();
        let depth = 0;
        for (const token of value.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\]]/g)) {
            const text = token[0];
            if (text[0] !== '"') {
                depth += text === '{' || text === '[' ? 1 : -1;
                continue;
            }
            if (depth !== 1) continue;
            let after = token.index + text.length;
            while (after < value.length && /\s/.test(value[after])) after++;
            if (value[after] !== ':') continue;
            const key = JSON.parse(text);
            if (keys.has(key)) return null;
            keys.add(key);
        }
        return pattern(parsed);
    }
    function episode(row) {
        // Each representation is independently complete: never combine a task
        // from one with an outcome from another. Conflicting valid copies exclude
        // the row; identical copies count once. Unknown metadata is not forwarded.
        const candidates = [pattern(row), payload(own(row, 'value')?.value), payload(own(row, 'content')?.value)]
            .filter(Boolean);
        if (!candidates.length) return null;
        const first = candidates[0];
        const fields = ['task', 'reward', 'success', 'critique', 'input', 'output', 'similarity'];
        if (candidates.some(candidate => fields.some(name => !Object.is(own(first, name)?.value, own(candidate, name)?.value))))
            return null;
        return first;
    }
    try {
        const query = own(params, 'query');
        const limit = own(params, 'maxEntries');
        if (!query || !Object.hasOwn(query, 'value') || typeof query.value !== 'string'
            || !query.value.trim() || query.value.length > 10000)
            throw new Error('query must be a non-empty string of at most 10000 characters');
        if (limit && (!Object.hasOwn(limit, 'value') || !Number.isSafeInteger(limit.value) || limit.value <= 0))
            throw new Error('maxEntries must be a positive safe integer when supplied');
        const maxEntries = limit ? limit.value : 10;
        phase = 'registry';
        const registry = await getRegistry();
        if (!registry || typeof registry.get !== 'function') throw new Error('AgentDB registry not available');
        phase = 'controller';
        const CS = registry.get('contextSynthesizer');
        if (!CS || typeof CS.synthesize !== 'function') throw new Error('ContextSynthesizer not available');
        phase = 'recall';
        const hm = registry.get('hierarchicalMemory');
        if (!hm || typeof hm.recall !== 'function') throw new Error('Hierarchical memory recall not available');
        const recalled = typeof hm.promote === 'function'
            ? await hm.recall({ query: query.value, k: maxEntries })
            : await hm.recall(query.value, maxEntries);
        if (!Array.isArray(recalled)) throw new Error('Hierarchical recall did not return an array');
        counts.recalledCount = recalled.length;
        phase = 'eligibility';
        const memories = [];
        for (const row of recalled) {
            const valid = episode(row);
            if (valid) memories.push(valid);
        }
        counts.eligibleCount = memories.length;
        counts.excludedCount = recalled.length - memories.length;
        if (recalled.length && !memories.length) return {
            success: false, status: 'no-eligible-episodes', inputContract, ...counts,
            error: 'Recalled rows contain no eligible episodes: explicit task, finite numeric reward and boolean success are required.',
        };
        phase = 'synthesis';
        // Retain the native empty-result shape, explicitly labelled no-memories.
        const result = await CS.synthesize(memories, { includeRecommendations: true });
        if (!isObject(result) || typeof result.summary !== 'string'
            || !['patterns', 'recommendations', 'keyInsights'].every(name =>
                Array.isArray(result[name]) && result[name].every(value => typeof value === 'string'))
            || !Number.isFinite(result.successRate) || result.successRate < 0 || result.successRate > 1
            || !Number.isFinite(result.averageReward) || result.totalMemories !== memories.length)
            throw new Error('ContextSynthesizer returned an invalid synthesis');
        return {
            success: true,
            status: !recalled.length ? 'no-memories' : counts.excludedCount ? 'partial' : 'complete',
            synthesis: result, inputContract, ...counts,
        };
    }
    catch (e) {
        return {
            success: false, status: 'error', phase, inputContract, ...counts,
            error: e instanceof Error ? e.message : typeof e === 'string' ? e : 'Unknown context synthesis error',
        };
    }
}`;

export const CONTEXT_ENTRIES = [{
  id: 'ruflo-context-contract/validated-episodes',
  target: 'ruflo-context-contract',
  suffix: ['@claude-flow', 'cli', 'dist', 'src', 'memory', 'memory-bridge.js'],
  edits: [{ find: CONTEXT_OLD, replace: CONTEXT_NEW }],
}];
