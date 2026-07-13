// Register / remove the user-level SessionStart hook that keeps the library
// patched. Pure logic; the CLI decides what to print.

import fs from 'node:fs';
import {
  SETTINGS_PATH, SESSION_START_SCRIPT, NOTIFY_SCRIPT, HOOK_MARKER, HOOK_MARKER_NOTIFY,
} from './paths.mjs';

// Two hooks, two jobs.
//
//   SessionStart      re-apply the patches, and report anything broken. Runs once, at start.
//   UserPromptSubmit  report only. Runs on every prompt, does almost nothing (reads one
//                     small file, usually absent) — and exists because SessionStart is too
//                     late: a new ruflo version can land in the npx cache MID-session and
//                     silently disable a patch, which is precisely how 3.26.1 arrived.
//
// Registered as separate marked entries so uninstall can remove exactly ours.
const HOOKS = [
  { event: 'SessionStart', marker: HOOK_MARKER, script: () => SESSION_START_SCRIPT, timeout: 5000,
    note: 'ruflo-source-patch — re-applies the source patches (ruvnet/ruflo#2633 et al) to any copy fetched since the last session' },
  { event: 'UserPromptSubmit', marker: HOOK_MARKER_NOTIFY, script: () => NOTIFY_SCRIPT, timeout: 3000,
    note: 'ruflo-source-patch — warns if a patch has stopped applying (upstream changed shape). Reports only; never blocks.' },
];

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

  let added = 0;
  let updated = 0;

  for (const spec of HOOKS) {
    settings.hooks[spec.event] = settings.hooks[spec.event] || [];
    const want = `node "${spec.script()}"`;

    // Self-heal a drifted command. Presence of OUR marker used to be treated as "nothing to
    // do" — but the marker says the hook is ours, not that it still points anywhere real.
    // When the script path moves (it did: flat -> lib/cwd/), an existing install would
    // otherwise keep invoking the old path forever, and a hook that silently no-ops is
    // worse than no hook: `status` says "installed" while nothing is being re-applied.
    let present = false;
    for (const g of settings.hooks[spec.event]) {
      for (const h of g.hooks || []) {
        if (!h || h[spec.marker] !== true) continue;
        present = true;
        if (h.command !== want) { h.command = want; updated++; }
      }
    }
    if (present) continue;

    settings.hooks[spec.event].push({
      hooks: [{
        type: 'command',
        command: want,
        timeout: spec.timeout,
        [spec.marker]: true,
        _note: `${spec.note} — remove with \`npx github:sparkling/ruflo-source-patch <target> uninstall\``,
      }],
    });
    added++;
  }

  if (added || updated) fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  return { added: added > 0, count: added, updated };
}

export function removeHook(settingsPath = SETTINGS_PATH) {
  if (!fs.existsSync(settingsPath)) return { removed: 0 };
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  let removed = 0;
  // Both of ours: SessionStart (re-apply) and UserPromptSubmit (notify). Marker-matched, so
  // a user's own hooks on the same events are never touched.
  for (const spec of HOOKS) {
    const list = settings.hooks?.[spec.event];
    if (!Array.isArray(list)) continue;
    settings.hooks[spec.event] = list
      .map((g) => {
        if (!g || !Array.isArray(g.hooks)) return g;
        const kept = g.hooks.filter((h) => !(h && h[spec.marker] === true));
        if (kept.length === g.hooks.length) return g;
        removed += g.hooks.length - kept.length;
        return kept.length ? { ...g, hooks: kept } : null;
      })
      .filter(Boolean);
  }
  if (removed > 0) fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  return { removed };
}
