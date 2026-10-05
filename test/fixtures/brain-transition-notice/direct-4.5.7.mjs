export function transitionPendingNotice(projectDir, payload, message) {
  const { projectRoot } = resolveProjectStore({ projectDir, gitTimeoutMs: 500 });
  return conditionNotice({ swarm: path.join(projectRoot, '.swarm'),
    session: normalizeHostEvent(payload)?.session_id, condition: 'project-transition-pending-readback', message });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
    const projectDir = payload.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const result = runProjectTransitionHook(projectDir, process.argv[2], { payload });
    if (result.state === 'pending') {
      const message = transitionPendingNotice(projectDir, payload, 'Project memory transition is pending; exact AgentDB readback was not verified at this boundary.');
      if (message) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: process.argv[2], additionalContext: message } }));
    }
  } catch { process.stdout.write(JSON.stringify({ systemMessage: 'Project memory transition capture degraded; exact readback was not verified.' })); }
}
