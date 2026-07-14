// Dispatch for the `verify-interface` target — patches the installed `ruvnet-brain` plugin's PreToolUse
// gate (stuinfla/ruvnet-brain#12). See patcher.mjs for what is broken and why.
//
// Recorded in state.json like every other plugin target, so the SessionStart hook and the monitor
// re-apply it: a `/plugin update` re-fetches ruvnet-brain wholesale and reverts the fix silently, and an
// unpatched gate does not announce itself — it just starts blocking your commands again.

import { apply, restore, status } from './patcher.mjs';
import { addPluginTargets, removePluginTargets, readState, isEmpty } from '../cwd/state.mjs';
import { installHook, removeHook } from '../cwd/hooks.mjs';
import { syncStableCopy } from '../cwd/commands.mjs';

export function verifyInterfaceCommand(action) {
  const log = (m) => console.log(`[verify-interface] ${m}`);

  if (action === 'install' || action === 'init') {
    syncStableCopy();
    addPluginTargets(['verify-interface']);
    const h = installHook();
    if (h.added) log('registered SessionStart hook');
    else if (h.updated) log('SessionStart hook path refreshed');

    const r = apply();
    for (const l of r.log) log(l);
    log(`patched: ${r.patched}, unchanged: ${r.unchanged}, skipped: ${r.skipped}${r.incomplete ? `, INCOMPLETE: ${r.incomplete}` : ''}${r.errors ? `, ERRORS: ${r.errors}` : ''}`);

    if (r.incomplete || r.errors) {
      log('WARNING: at least one copy is only partially patched.');
      log('         A partial apply here is worse than none — the regex edit adds capture groups, so if');
      log('         it landed and a BASH_REMATCH reader did not, the gate reads the wrong groups.');
      log('         Run `verify-interface uninstall` to restore the vendor bytes.');
      process.exitCode = 1;
      return true;
    }
    log('re-applied on session start and by the monitor (survives /plugin update)');
    return true;
  }

  if (action === 'uninstall' || action === 'remove') {
    const state = removePluginTargets(['verify-interface']);
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
    const installed = readState().pluginTargets.includes('verify-interface');
    const s = status();
    for (const l of s.log) log(l);
    log(`${s.patched}/${s.files} installed copy/copies patched — ${installed ? 'tracked (re-applied on session start + monitor)' : 'NOT tracked (run `verify-interface install` so it survives /plugin update)'}`);
    return true;
  }

  return false;
}
