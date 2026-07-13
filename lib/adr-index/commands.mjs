// Dispatch for the `adr-index` target — patches the installed `ruflo-adr` plugin's
// importer (`scripts/import.mjs`) in place (ruvnet/ruflo#2660). See patcher.mjs for the
// fix and why it's needed.
//
// Like the CLI patch targets, install RECORDS the target in state.json and registers the
// SessionStart hook, so the hook and the monitor re-apply it. Without that, an explicit
// `/plugin update` would silently drop the patch — and adr-index does not fail loudly
// when unpatched, it just resumes reporting `Records stored: N/N` while writing nothing.

import { apply, restore, status } from './patcher.mjs';
import { addPluginTargets, removePluginTargets, readState, isEmpty } from '../cwd/state.mjs';
import { installHook, removeHook } from '../cwd/hooks.mjs';
import { syncStableCopy } from '../cwd/commands.mjs';

export function adrIndexCommand(action) {
  const log = (m) => console.log(`[adr-index] ${m}`);

  if (action === 'install' || action === 'init') {
    syncStableCopy();
    addPluginTargets(['adr-index']);
    const h = installHook();
    if (h.added) log('registered SessionStart hook');
    else if (h.updated) log('SessionStart hook path refreshed');

    const r = apply();
    for (const l of r.log) log(l);
    log(`patched: ${r.patched}, unchanged: ${r.unchanged}, skipped: ${r.skipped}${r.incomplete ? `, INCOMPLETE: ${r.incomplete}` : ''}`);
    if (r.incomplete) {
      log('WARNING: at least one copy is only partially patched and still carries #2660.');
      log('         Re-run `adr-index status` for the missing edits.');
    }
    log('re-applied on session start and by the monitor (survives /plugin update)');
    return true;
  }

  if (action === 'uninstall' || action === 'remove') {
    const state = removePluginTargets(['adr-index']);
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
    const installed = readState().pluginTargets.includes('adr-index');
    const s = status();
    for (const l of s.log) log(l);
    log(`${s.patched}/${s.files} installed copy/copies patched — ${installed ? 'tracked (re-applied on session start + monitor)' : 'NOT tracked (run `adr-index install` so it survives /plugin update)'}`);
    return true;
  }

  return false;
}
