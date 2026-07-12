// Register / remove the user-level SessionStart hook that keeps the library
// patched. Pure logic; the CLI decides what to print.

import fs from 'node:fs';
import { SETTINGS_PATH, SESSION_START_SCRIPT, HOOK_MARKER } from './paths.mjs';

function hookCommand() {
  // Absolute path to the stable copy; shell-form (no args field) so it runs
  // under sh -c and this expands correctly. We embed the resolved path rather
  // than $HOME so it's unambiguous.
  return `node "${SESSION_START_SCRIPT}"`;
}

export function installHook(settingsPath = SETTINGS_PATH) {
  if (!fs.existsSync(settingsPath)) throw new Error(`settings file not found: ${settingsPath}`);
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  settings.hooks = settings.hooks || {};
  settings.hooks.SessionStart = settings.hooks.SessionStart || [];
  const already = settings.hooks.SessionStart.some((g) =>
    (g.hooks || []).some((h) => h && h[HOOK_MARKER] === true));
  if (already) return { added: false };
  settings.hooks.SessionStart.push({
    hooks: [
      {
        type: 'command',
        command: hookCommand(),
        timeout: 5000,
        [HOOK_MARKER]: true,
        _note: 'ruflo-source-patch (ruvnet/ruflo#2633 workaround) — keeps @claude-flow/cli patched to resolve project root instead of raw cwd; remove with `npx ruflo-source-patch uninstall`',
      },
    ],
  });
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  return { added: true };
}

export function removeHook(settingsPath = SETTINGS_PATH) {
  if (!fs.existsSync(settingsPath)) return { removed: 0 };
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  let removed = 0;
  if (settings.hooks && Array.isArray(settings.hooks.SessionStart)) {
    settings.hooks.SessionStart = settings.hooks.SessionStart
      .map((g) => {
        if (!g || !Array.isArray(g.hooks)) return g;
        const kept = g.hooks.filter((h) => !(h && h[HOOK_MARKER] === true));
        if (kept.length === g.hooks.length) return g;
        removed += g.hooks.length - kept.length;
        return kept.length ? { ...g, hooks: kept } : null;
      })
      .filter(Boolean);
  }
  if (removed > 0) fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  return { removed };
}
