export function mergeSettingsForUpgrade(existing, targetDir) {
    // Scan the pre-existing hooks/permissions BEFORE they get spread into
    // `merged` below — this is the untrusted, disk-sourced content a
    // malicious settings.json would use to smuggle a hook payload through.
    const warnings = formatRiskFindingsAsWarnings(scanSettingsForRisk({ hooks: existing.hooks, permissions: existing.permissions }));
    const merged = { ...existing };
    // User-level settings (~/.claude/settings.json) apply to every opened
    // project, so their helper commands never look inside the project.
    const scope = helperScopeFor(targetDir);
    const platform = detectPlatform();
    const isWindows = platform.os === 'windows';
    // Platform-specific command wrappers
    // Windows: Use PowerShell-compatible commands
    // Mac/Linux: Use bash-compatible commands with 2>/dev/null
    // NOTE: teammateIdleCmd and taskCompletedCmd were removed.
    // TeammateIdle/TaskCompleted are not valid Claude Code hook events and caused warnings.
    // Agent Teams hook config lives in claudeFlow.agentTeams.hooks instead.
    // 1. Merge env vars (preserve existing, add new)
    const existingEnv = existing.env || {};
    merged.env = {
        ...existingEnv,
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
        CLAUDE_FLOW_V3_ENABLED: existingEnv.CLAUDE_FLOW_V3_ENABLED || 'true',
        CLAUDE_FLOW_HOOKS_ENABLED: existingEnv.CLAUDE_FLOW_HOOKS_ENABLED || 'true',
    };
    // 2. Merge hooks (preserve existing, add new Agent Teams + auto-memory hooks)
    const existingHooks = existing.hooks || {};
    merged.hooks = { ...existingHooks };
    // Auto-memory hook commands. They go through helperHookCommand like every other
    // helper hook (#4058): the previous `node -e "…import(file)" import` form left the
    // subcommand in process.argv[1], the helper read argv[2], and both hooks only
    // printed the status banner. Hooks run in the project directory with
    // CLAUDE_PROJECT_DIR set, so the shared probe resolves the helper without a
    // `git rev-parse` of its own.
    const autoMemoryScript = '.claude/helpers/auto-memory-hook.mjs';
    const autoMemoryImportCmd = helperHookCommand(autoMemoryScript, 'import', scope);
    const autoMemorySyncCmd = helperHookCommand(autoMemoryScript, 'sync', scope);
    // Add auto-memory import to SessionStart (if not already present)
    const sessionStartHooks = existingHooks.SessionStart;
    const hasAutoMemoryImport = sessionStartHooks?.some(group => group.hooks?.some(h => h.command?.includes('auto-memory-hook')));
    if (!hasAutoMemoryImport) {
        const startHooks = merged.hooks;
        if (!startHooks.SessionStart) {
            startHooks.SessionStart = [{ hooks: [] }];
        }
        const startGroup = startHooks.SessionStart[0];
        if (!startGroup.hooks)
            startGroup.hooks = [];
        startGroup.hooks.push({
            type: 'command',
            command: autoMemoryImportCmd,
            timeout: AUTO_MEMORY_HOOK_TIMEOUT_S,
            continueOnError: true,
        });
    }
    // Add auto-memory sync to SessionEnd (if not already present)
    const sessionEndHooks = existingHooks.SessionEnd;
    const hasAutoMemorySync = sessionEndHooks?.some(group => group.hooks?.some(h => h.command?.includes('auto-memory-hook')));
    if (!hasAutoMemorySync) {
        const endHooks = merged.hooks;
        if (!endHooks.SessionEnd) {
            endHooks.SessionEnd = [{ hooks: [] }];
        }
        const endGroup = endHooks.SessionEnd[0];
        if (!endGroup.hooks)
            endGroup.hooks = [];
        // Insert at beginning so sync runs before other cleanup
        endGroup.hooks.unshift({
            type: 'command',
            command: autoMemorySyncCmd,
            timeout: AUTO_MEMORY_HOOK_TIMEOUT_S,
            continueOnError: true,
        });
    }
    // NOTE: TeammateIdle and TaskCompleted are NOT valid Claude Code hook events.
    // They cause warnings when present in settings.json hooks.
    // Remove them if they exist from a previous init.
    delete merged.hooks.TeammateIdle;
    delete merged.hooks.TaskCompleted;
    // Their configuration lives in claudeFlow.agentTeams.hooks instead.
    // 3. Fix statusLine config (remove invalid fields, ensure correct format)
    // Claude Code only supports: type, command, padding
    //
    // #2448 — Detect and REGENERATE the runaway `npx @claude-flow/cli@latest`
    // statusline form. Pre-#2337 init wrote this to settings.json; it spawns
    // a cold Node process + npm registry round-trip on every fire (statusline
    // refires every few hundred ms), which on macOS produced load average 49
    // / jetsam / kernel panic. Preserving the user's existing command (the
    // old behavior here) means anyone who installed pre-#2337 and upgraded
    // never gets the fix. Now we detect the broken form and overwrite.
    const NEW_STATUSLINE_CMD = scope === 'user' ? helperStatusLineCommand('user') : GIT_ROOT_STATUSLINE_CMD;
    // Matches any invocation of `claude-flow hooks statusline` — either via npx
    // (`npx [--prefer-offline] [@]claude-flow[/cli][@<tag>] hooks statusline …`)
    // or as a bare command (`claude-flow hooks statusline …`). Both forms cold-
    // load the ONNX model on every fire (~1s); Claude Code times out and hides
    // the status bar (#2450). The migration replaces the whole command with
    // NEW_STATUSLINE_CMD which invokes the local helper directly via `node -e`.
    // Flag-list repetition bounded at 10 (real invocations never carry more) —
    // an unbounded `*` here is exponential-backtracking-prone (CodeQL
    // js/redos): a crafted settings.json command string with dozens of
    // dash-token repetitions can hang this check for minutes.
    const BROKEN_STATUSLINE_RE = /(?:npx\s+(?:--?\S+\s+){0,10})?@?claude-flow(?:\/cli)?(?:@\S+)?\s+hooks\s+statusline/;
    const BROKEN_NPX_LATEST_RE = /npx\s+(?:--?\S+\s+){0,10}@?claude-flow\/cli@latest\s+\S+/;
    const existingStatusLine = existing.statusLine;
    if (existingStatusLine) {
        const existingCmd = typeof existingStatusLine.command === 'string' ? existingStatusLine.command : '';
        const isBroken = BROKEN_STATUSLINE_RE.test(existingCmd) || BROKEN_NPX_LATEST_RE.test(existingCmd);
        const pinned = scope === 'user' ? pinToUserHelpers(existingCmd) : null;
        merged.statusLine = {
            type: 'command',
            command: isBroken || !existingCmd ? NEW_STATUSLINE_CMD : pinned ?? existingCmd,
            // Remove invalid fields: refreshMs, enabled (not supported by Claude Code)
        };
    }
    // #2448 / #2677 — Detect and REGENERATE per-action hook commands that still
    // use the runaway `npx @claude-flow/cli@latest hooks <sub>` form. These fire
    // on every PreToolUse/PostToolUse/UserPromptSubmit, each spawning ~130 MB
    // of cold Node + npm registry resolution; the storm is what kernel-paniced
    // the reporter's machine in #2448.
    //
    // We walk each hook event's `hooks[]` and swap any command matching the
    // broken pattern for the local-helper form. Idempotent: re-running this
    // migration on already-correct settings is a no-op.
    // Bounded for the same reason as BROKEN_STATUSLINE_RE above (CodeQL js/redos).
    const BROKEN_HOOK_RE = /npx\s+(?:--?\S+\s+){0,10}@?claude-flow\/cli@latest\s+hooks\s+(\S+)/;
    // Same command settings-generator.ts emits for this settings scope.
    const localHookCmd = (sub) => helperHookCommand('.claude/helpers/hook-handler.cjs', sub, scope);
    const mergedHooks = merged.hooks;
    if (mergedHooks) {
        for (const eventName of Object.keys(mergedHooks)) {
            const groups = mergedHooks[eventName];
            if (!Array.isArray(groups))
                continue;
            for (const group of groups) {
                if (!Array.isArray(group.hooks))
                    continue;
                group.hooks = group.hooks.filter((h) => {
                    if (typeof h?.command !== 'string')
                        return true;
                    // A user-level probe ruflo generated earlier is re-pinned to HOME.
                    const pinned = scope === 'user' ? pinToUserHelpers(h.command) : null;
                    if (pinned) {
                        h.command = pinned;
                        return true;
                    }
                    const m = BROKEN_HOOK_RE.exec(h.command);
                    if (m) {
                        // Subcommand captured (e.g. "pre-bash", "post-edit", "route") — keep it.
                        h.command = localHookCmd(m[1]);
                        return true;
                    }
                    // Sibling CLI invocations (memory/daemon/swarm/...) have no
                    // hook-handler equivalent. Drop the stale extra; the merge above
                    // has already installed current local-helper hooks for this event.
                    return !BROKEN_NPX_LATEST_RE.test(h.command);
                });
            }
        }
    }
    // 4. Merge claudeFlow settings (preserve existing, add agentTeams + memory)
    const existingClaudeFlow = existing.claudeFlow || {};
    const existingMemory = existingClaudeFlow.memory || {};
    merged.claudeFlow = {
        ...existingClaudeFlow,
        version: existingClaudeFlow.version || '3.0.0',
        enabled: existingClaudeFlow.enabled !== false,
        agentTeams: {
            enabled: true,
            teammateMode: 'auto',
            taskListEnabled: true,
            mailboxEnabled: true,
            coordination: {
                // #3031: an upgrade must remove the unsafe generated default. Idle
                // status is not proof that a task is unowned or inside agent scope.
                autoAssignOnIdle: false,
                trainPatternsOnComplete: true,
                notifyLeadOnComplete: true,
                sharedMemoryNamespace: 'agent-teams',
            },
            hooks: {
                teammateIdle: { enabled: true, autoAssign: false, checkTaskList: true },
                taskCompleted: { enabled: true, trainPatterns: true, notifyLead: true },
            },
        },
        memory: {
            ...existingMemory,
            learningBridge: existingMemory.learningBridge ?? { enabled: true },
            memoryGraph: existingMemory.memoryGraph ?? { enabled: true },
            agentScopes: existingMemory.agentScopes ?? { enabled: true },
        },
    };
    return { merged, warnings };
}