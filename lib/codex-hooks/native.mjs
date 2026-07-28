import fs from 'node:fs';
import path from 'node:path';

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

export function inspectNativeLifecycle({ root, brainHome, isOurs }) {
  const manifestFile = path.join(root, 'plugin', '.codex-plugin', 'plugin.json');
  const hooksFile = path.join(root, 'plugin', 'hooks', 'codex-hooks.json');
  const adapterFile = path.join(root, 'plugin', 'scripts', 'codex-hook-adapter.mjs');
  const nativeWrapper = path.join(brainHome, 'codex-hook.mjs');
  const manifestBody = (() => { try { return fs.readFileSync(manifestFile, 'utf8'); } catch { return ''; } })();
  const hooksBody = (() => { try { return fs.readFileSync(hooksFile, 'utf8'); } catch { return ''; } })();
  const adapterBody = (() => { try { return fs.readFileSync(adapterFile, 'utf8'); } catch { return ''; } })();
  const manifest = readJson(manifestFile);
  const hooks = readJson(hooksFile);
  const requiredEvents = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'SessionEnd', 'Stop'];
  const commands = requiredEvents.flatMap((event) =>
    Array.isArray(hooks?.hooks?.[event])
      ? hooks.hooks[event].flatMap((group) =>
        Array.isArray(group?.hooks) ? group.hooks.map((hook) => hook?.command) : [])
      : []);
  const stableCommand = 'node "$HOME/.cache/ruvnet-brain/codex-hook.mjs" ';
  const active = readJson(path.join(brainHome, 'active.json'));
  const activeRoot = typeof active?.codeRoot === 'string'
    ? (path.isAbsolute(active.codeRoot) ? active.codeRoot : path.join(brainHome, active.codeRoot))
    : null;
  const activeAdapter = activeRoot && path.join(activeRoot, 'scripts', 'codex-hook-adapter.mjs');
  const activeAdapterBody = (() => {
    try { return activeAdapter ? fs.readFileSync(activeAdapter, 'utf8') : ''; } catch { return ''; }
  })();
  const wrapperBody = (() => { try { return fs.readFileSync(nativeWrapper, 'utf8'); } catch { return ''; } })();

  const checks = [
    {
      label: 'upstream Codex plugin manifest',
      ok: Boolean(manifestBody)
        && !isOurs(manifestBody)
        && manifest?.name === 'ruvnet-brain'
        && manifest?.hooks === './hooks/codex-hooks.json',
    },
    {
      label: 'upstream Codex lifecycle manifest',
      ok: Boolean(hooksBody)
        && !isOurs(hooksBody)
        && requiredEvents.every((event) => Array.isArray(hooks?.hooks?.[event]))
        && commands.length >= requiredEvents.length
        && commands.every((command) => typeof command === 'string' && command.startsWith(stableCommand)),
    },
    {
      label: 'upstream Codex hook adapter',
      ok: Boolean(adapterBody)
        && !isOurs(adapterBody)
        && adapterBody.includes("RUVNET_HOOK_HOST: 'codex'")
        && adapterBody.includes('hook-shim.mjs'),
    },
    {
      label: 'installed stable wrapper and active adapter',
      ok: Boolean(wrapperBody)
        && wrapperBody.includes('active.json')
        && wrapperBody.includes('codex-hook-adapter.mjs')
        && Boolean(activeAdapterBody)
        && activeAdapterBody === adapterBody,
    },
  ];
  return {
    surface: Boolean(
      (manifestBody && !isOurs(manifestBody))
      || (hooksBody && !isOurs(hooksBody))
      || (adapterBody && !isOurs(adapterBody)),
    ),
    ready: checks.every((check) => check.ok),
    checks,
  };
}
