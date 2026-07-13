// Dispatch for the `adr-template` target — patches the installed `ruflo-adr` plugin's
// `adr-create` skill template in place (ruvnet/ruflo#2659). See patcher.mjs for the fix
// and why it's needed.
//
// Like the CLI patch targets, install RECORDS the target in state.json and registers the
// SessionStart hook, so the hook and the monitor re-apply it — otherwise an explicit
// `/plugin update` silently reverts it and every ADR authored afterwards goes back to
// indexing with empty status/date/tags, with nothing to signal it.

import { apply, revert, status } from './patcher.mjs';
import { addPluginTargets, removePluginTargets, readState, isEmpty } from '../cwd/state.mjs';
import { installHook, removeHook } from '../cwd/hooks.mjs';
import { syncStableCopy } from '../cwd/commands.mjs';

export function adrTemplateCommand(action) {
  const log = (m) => console.log(`[adr-template] ${m}`);

  if (action === 'install' || action === 'init') {
    syncStableCopy();
    addPluginTargets(['adr-template']);
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
    const state = removePluginTargets(['adr-template']);
    const r = revert();
    for (const l of r.log) log(l);
    log(r.reverted ? `reverted ${r.reverted} file(s)` : 'nothing to revert (not installed)');
    if (isEmpty(state)) {
      const h = removeHook();
      if (h.removed) log('nothing left installed — SessionStart hook removed');
    }
    return true;
  }

  if (action === 'status') {
    const installed = readState().pluginTargets.includes('adr-template');
    const s = status();
    for (const l of s.log) log(l);
    log(`${s.patched}/${s.files} installed copy/copies patched — ${installed ? 'tracked (re-applied on session start + monitor)' : 'NOT tracked (run `adr-template install` so it survives /plugin update)'}`);
    return true;
  }

  return false;
}
