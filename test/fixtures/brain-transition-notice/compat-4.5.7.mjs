// Compatibility entrypoint uses the same minimized transition producer as direct registrations.
  // Finish evaluating this module before importing its transition consumer.
  void (async () => {
  try {
    const { runProjectTransitionHook, transitionPendingNotice } = await import('./project-transition-hook.mjs');
    const payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
    const projectDir = payload.cwd || projectDirectory();
    const result = runProjectTransitionHook(projectDir, process.argv[2], { payload });
    if (result.state === 'pending') {
      const message = transitionPendingNotice(projectDir, payload, 'Project memory transition remains pending; exact readback was not verified.');
      if (message) process.stdout.write(JSON.stringify({ systemMessage: message }));
    }
  } catch { process.stdout.write(JSON.stringify({ systemMessage: 'Project memory transition capture degraded; exact readback was not verified.' })); }
  })();