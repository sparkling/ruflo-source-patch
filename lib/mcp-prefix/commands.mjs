// Dispatch for the `mcp-prefix` target — rewrites the ruflo plugins' bundled MCP
// tool references from `mcp__claude-flow__*` to the plugin-namespaced
// `mcp__plugin_ruflo-core_ruflo__*` (ruvnet/ruflo#2685). See patcher.mjs.
//
// Like the other plugin targets, install RECORDS the target in state.json and
// registers the SessionStart hook, so the hook and the monitor re-apply it —
// otherwise a `/plugin update` re-fetches the plugins and silently restores the
// bare `mcp__claude-flow__*` references, and under plugin loading the bundled
// allowed-tools grant nothing again, with nothing to signal it.

import { apply, restore, status } from './patcher.mjs';
import { addPluginTargets, removePluginTargets, readState, isEmpty } from '../cwd/state.mjs';
import { installHook, removeHook } from '../cwd/hooks.mjs';
import { syncStableCopy } from '../cwd/commands.mjs';

export function mcpPrefixCommand(action) {
  const log = (m) => console.log(`[mcp-prefix] ${m}`);

  if (action === 'install' || action === 'init') {
    syncStableCopy();
    addPluginTargets(['mcp-prefix']);
    const h = installHook();
    if (h.added) log('registered SessionStart hook');
    else if (h.updated) log('SessionStart hook path refreshed');

    const r = apply();
    for (const l of r.log) log(l);
    log(`patched: ${r.patched}, unchanged: ${r.unchanged}, skipped: ${r.skipped}`);
    log('re-applied on session start and by the monitor (survives /plugin update)');
    return true;
  }

  if (action === 'uninstall' || action === 'remove') {
    const state = removePluginTargets(['mcp-prefix']);
    const r = restore();
    for (const l of r.log) log(l);
    log(r.restored ? `restored ${r.restored} file(s)` : 'nothing to restore (not installed)');
    if (isEmpty(state)) {
      const h = removeHook();
      if (h.removed) log('nothing left installed — SessionStart hook removed');
    }
    return true;
  }

  if (action === 'status') {
    const installed = readState().pluginTargets.includes('mcp-prefix');
    const s = status();
    for (const l of s.log) log(l);
    log(`${s.patched}/${s.files} bundled file(s) patched — ${installed ? 'tracked (re-applied on session start + monitor)' : 'NOT tracked (run `mcp-prefix install` so it survives /plugin update)'}`);
    return true;
  }

  return false;
}
