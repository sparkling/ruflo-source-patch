// One command implementation for all four composing plugin targets (adr-template, adr-index,
// verify-interface, mcp-prefix). Each of their command modules is now a one-liner delegating here.
//
// install/uninstall record the target in state.json and (un)register the SessionStart hook exactly as
// before — the difference is that the actual patching goes through the shared composition engine
// (plugin-compose.mjs, ADR-020) with the FULL set of installed compose targets, so a file shared by two
// targets is rebuilt from one pristine instead of each target fighting over the backup.

import { applyComposed, reconcile, statusComposed, COMPOSE_TARGETS } from './plugin-compose.mjs';
import { addPluginTargets, removePluginTargets, readState, isEmpty } from './cwd/state.mjs';
import { installHook, removeHook } from './cwd/hooks.mjs';
import { syncStableCopy } from './cwd/commands.mjs';

const installedComposeTargets = () => readState().pluginTargets.filter((t) => COMPOSE_TARGETS.includes(t));

export function runPluginCommand(name, action) {
  const log = (m) => console.log(`[${name}] ${m}`);

  if (action === 'install' || action === 'init') {
    syncStableCopy();
    addPluginTargets([name]);
    const h = installHook();
    if (h.added) log('registered SessionStart hook');
    else if (h.updated) log('SessionStart hook path refreshed');

    const r = applyComposed(installedComposeTargets());
    for (const l of r.log) log(l);
    log(`patched: ${r.patched}, unchanged: ${r.unchanged}, skipped: ${r.skipped}${r.incomplete ? `, INCOMPLETE: ${r.incomplete}` : ''}${r.errors ? `, ERRORS: ${r.errors}` : ''}`);
    if (r.incomplete || r.errors) {
      // A partial apply must never look like success. For verify-interface especially, a landed regex
      // edit without its BASH_REMATCH readers leaves the gate blocking on garbage, so this is loud and
      // exits nonzero. The engine already declines to WRITE an atomic target's partial edits.
      log('WARNING: at least one copy is only partially patched — run `<target> status` for the missing edits.');
      process.exitCode = 1;
      return true;
    }
    log('re-applied on session start and by the monitor (survives /plugin update)');
    return true;
  }

  if (action === 'uninstall' || action === 'remove') {
    const state = removePluginTargets([name]);
    const r = reconcile(installedComposeTargets(), [name]);
    for (const l of r.log) log(l);
    log(r.restored ? `restored ${r.restored} file(s)` : 'nothing to restore (not installed)');
    if (isEmpty(state)) {
      const h = removeHook();
      if (h.removed) log('nothing left installed — SessionStart hook removed');
    }
    return true;
  }

  if (action === 'status') {
    const installed = readState().pluginTargets.includes(name);
    const s = statusComposed()[name] || { files: 0, patched: 0 };
    log(`${s.patched}/${s.files} file(s) patched — ${installed ? 'tracked (re-applied on session start + monitor)' : `NOT tracked (run \`${name} install\` so it survives /plugin update)`}`);
    return true;
  }

  return false;
}
