// Exact native hooksPostCommand, CLI 3.71.4.
export const hooksPostCommand = {
    name: 'hooks_post-command',
    description: 'Record command execution outcome Use when native Bash hooks (via Claude Code\'s settings.json) are wrong because you need Ruflo-side state — pattern persistence, neural training signals, model-routing learning, cost tracking, audit chain. For one-off shell commands, plain Bash hooks are fine.',
    inputSchema: {
        type: 'object',
        properties: {
            command: { type: 'string', description: 'Executed command' },
            exitCode: { type: 'number', description: 'Command exit code' },
            success: { type: 'boolean', description: 'Explicit execution outcome; false records a failure even without a nonzero exit code' },
            ttl: { type: 'integer', minimum: 1, maximum: 2147483647, description: 'Command history lifetime in seconds (default: 30 days)' },
        },
        required: ['command'],
    },
    handler: async (params) => {
        const command = params.command;
        const exitCode = params.exitCode || 0;
        const success = exitCode === 0 && params.success !== false;
        const ttl = params.ttl ?? 30 * 24 * 60 * 60;
        if (typeof ttl !== 'number' || !Number.isSafeInteger(ttl) || ttl < 1 || ttl > 2147483647) {
            return { success: false, recorded: false, error: 'ttl must be a positive integer number of seconds (at most 2147483647)' };
        }
        {
            const v = validateText(command, 'command');
            if (!v.valid)
                return { success: false, error: v.error };
        }
        // #6: feed the tool-loop circuit breaker so pre-command can warn/block on
        // repeated consecutive failures of the same command.
        recordCommandOutcome(command, success);
        // #4056: command history is opt-out (CLAUDE_FLOW_HOOKS_RECORD_COMMANDS=0,
        // CLAUDE_FLOW_HOOKS_ENABLED=false, or hooks.recordCommands=false in the
        // config). The circuit breaker above is in-memory only; nothing below
        // runs when recording is off, so no command text reaches the store or
        // the trajectory pipeline.
        if (commandRecordingDisabled(process.env, getProjectCwd())) {
            return {
                recorded: false,
                disabled: true,
                command: undefined,
                exitCode,
                success,
                timestamp: new Date().toISOString(),
                _storedIn: 'none',
                learningPath: 'recorded-only',
                trajectoriesDelta: 0,
                note: 'Command recording is switched off (CLAUDE_FLOW_HOOKS_RECORD_COMMANDS / CLAUDE_FLOW_HOOKS_ENABLED / hooks.recordCommands); nothing was stored.',
            };
        }
        // What is stored is the redacted, length-capped form, never the raw text.
        const storedCommand = redactCommandForStorage(command);
        // Persist command outcome via AgentDB
        let _storedIn = 'none';
        try {
            const bridge = await import('../memory/memory-bridge.js');
            const stored = await bridge.bridgeStoreEntry({
                key: `cmd-${Date.now()}`,
                value: JSON.stringify({ command: storedCommand, exitCode, success }),
                namespace: 'commands',
                tags: [success ? 'success' : 'error'],
                ttl,
                generateEmbeddingFlag: false,
            });
            if (!stored?.success)
                throw new Error(stored?.error || 'Native bridge did not store the command');
            _storedIn = 'agentdb';
        }
        catch {
            // AgentDB not available — store in JSON
            try {
                const store = loadMemoryStore();
                const now = Date.now();
                for (const [entryKey, entry] of Object.entries(store.entries)) {
                    if (entry.namespace === 'commands' && entry.expiresAt && Date.parse(entry.expiresAt) <= now) {
                        delete store.entries[entryKey];
                    }
                }
                const key = `cmd-${now}`;
                store.entries[key] = {
                    key, value: JSON.stringify({ command: storedCommand, exitCode, success }), namespace: 'commands',
                    storedAt: new Date(now).toISOString(), lastAccessed: new Date(now).toISOString(), accessCount: 0,
                    expiresAt: new Date(now + ttl * 1000).toISOString(),
                };
                const memDir = dirname(getMemoryPath());
                if (!existsSync(memDir))
                    mkdirSync(memDir, { recursive: true });
                writeFileSync(getMemoryPath(), JSON.stringify(store, null, 2), 'utf-8');
                _storedIn = 'json-store';
            }
            catch { /* non-critical */ }
        }
        // #2245 Round B — feed the trajectory pipeline so globalStats reflects
        // command outcomes alongside the AgentDB entry that already gets written.
        let learningPath = 'recorded-only';
        let trajectoriesDelta = 0;
        try {
            const intel = await import('../memory/intelligence.js');
            const before = intel.getIntelligenceStats().trajectoriesRecorded;
            await intel.recordTrajectory([{
                    type: 'action',
                    content: `Command \`${storedCommand.slice(0, 200)}\` exited ${exitCode} (${success ? 'success' : 'failure'})`,
                    metadata: { hook: 'post-command', command: storedCommand.slice(0, 500), exitCode, success },
                    timestamp: Date.now(),
                }], success ? 'success' : 'failure');
            trajectoriesDelta = intel.getIntelligenceStats().trajectoriesRecorded - before;
            if (trajectoriesDelta > 0)
                learningPath = 'trajectory-pipeline';
        }
        catch { /* intelligence module not yet initialised — keep recorded-only */ }
        return {
            recorded: _storedIn !== 'none',
            command,
            exitCode,
            success,
            timestamp: new Date().toISOString(),
            _storedIn,
            learningPath, // 'trajectory-pipeline' | 'recorded-only'
            trajectoriesDelta,
            note: learningPath === 'trajectory-pipeline'
                ? `Command outcome fed to the SONA + EWC++ trajectory pipeline (trajectoriesRecorded +${trajectoriesDelta}).`
                : `Command outcome stored via ${_storedIn}; the trajectory pipeline was not reachable in this process.`,
        };
    },
};
