// Read-only proof for a FRESH Codex host. Never acknowledges already-open windows.
export async function rspProveFreshCodexHost(recorded) {
  const host = recorded?.hosts?.codex;
  if (host?.state !== 'ready' || host.restartRequired !== true
    || host.restartScope !== 'unproven' || host.version !== PACKAGE_VERSION
    || recorded.desiredVersion !== PACKAGE_VERSION) return null;
  try {
    const plugin = codexPluginStatus();
    if (!plugin.available || !plugin.installed || !plugin.enabled || plugin.version !== PACKAGE_VERSION) return null;
    const root = codexInstalledPluginRoot({ status: plugin });
    if (!root) return null;
    const sourcePath = fs.realpathSync(path.join(root, 'hooks', 'codex-hooks.json'));
    const original = fs.readFileSync(sourcePath, 'utf8');
    const manifest = JSON.parse(original);
    const normalize = event => String(event).replaceAll('_', '').toLowerCase();
    const matcher = value => value === '*' ? null : value ?? null;
    const expected = Object.entries(manifest.hooks || {}).flatMap(([event, groups]) => groups.flatMap(group =>
      group.hooks.map(hook => ({ event: normalize(event), command: hook.command,
        matcher: matcher(group.matcher), timeout: hook.timeout ?? 600, type: hook.type }))));
    if (!expected.length || expected.some(hook => hook.type !== 'command' || typeof hook.command !== 'string')) return null;
    const listed = await codexHooksList();
    if (!listed.ok || !Array.isArray(listed.value?.data) || listed.value.data.length !== 1) return null;
    const group = listed.value.data[0];
    if (group.errors?.length || group.warnings?.length || !Array.isArray(group.hooks)) return null;
    const hooks = group.hooks.filter(hook => hook.pluginId === CODEX_PLUGIN_ID);
    if (hooks.length !== expected.length) return null;
    const remaining = [...expected];
    const keys = new Set();
    for (const hook of hooks) {
      if (hook.enabled !== true || hook.trustStatus !== 'trusted' || hook.handlerType !== 'command'
        || !/^sha256:[a-f0-9]{64}$/.test(hook.currentHash || '') || keys.has(hook.key)
        || fs.realpathSync(hook.sourcePath) !== sourcePath) return null;
      keys.add(hook.key);
      const index = remaining.findIndex(want => want.event === normalize(hook.eventName)
        && want.command === hook.command && want.matcher === matcher(hook.matcher) && want.timeout === hook.timeoutSec);
      if (index < 0) return null;
      remaining.splice(index, 1);
    }
    // Refuse a concurrent update rather than mixing generations in a green verdict.
    if (fs.readFileSync(sourcePath, 'utf8') !== original || codexPluginStatus().version !== plugin.version) return null;
    const current = classifyHostConvergence({ ...recorded, hosts: { ...recorded.hosts,
      codex: { ...host, restartScope: 'open-sessions' } } });
    if (!current.healthy) return null;
    return { ...current, state: 'fresh-host-ready',
      notice: 'Fresh Codex host verified: exact current hook definitions are enabled and trusted. '
        + 'Already-open windows may retain earlier boot declarations; update history is unchanged.' };
  } catch { return null; }
}
