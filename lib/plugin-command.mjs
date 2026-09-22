// One command implementation for all composing plugin targets. Each command module is a one-liner
// delegating here.
//
// install/uninstall record the target in state.json and (un)register the SessionStart hook exactly as
// before — the difference is that the actual patching goes through the shared composition engine
// (plugin-compose.mjs, ADR-020) with the FULL set of installed compose targets, so a file shared by two
// targets is rebuilt from one pristine instead of each target fighting over the backup.

import { applyComposed, reconcile, statusComposed, COMPOSE_TARGETS } from './plugin-compose.mjs';
import {
  addPluginTargets, removePluginTargets, readState, isEmpty, withPatchMutationLock,
} from './cwd/state.mjs';
import { installHook, removeHook } from './cwd/hooks.mjs';
import { syncStableCopy } from './cwd/commands.mjs';
import { retireSuperseded } from './supersede.mjs';

const installedComposeTargets = () => readState().pluginTargets.filter((t) => COMPOSE_TARGETS.includes(t));

function runPluginCommandUnlocked(name, action) {
  const log = (m) => console.log(`[${name}] ${m}`);

  if (action === 'install' || action === 'init') {
    syncStableCopy();
    addPluginTargets([name]);
    const supersession = retireSuperseded(readState());
    for (const line of supersession.log) log(line);
    const afterSupersession = readState();
    if (!afterSupersession.pluginTargets.includes(name)) {
      if (isEmpty(afterSupersession)) {
        const hook = removeHook();
        if (hook.removed) log('nothing left installed — SessionStart hook removed');
      }
      return true;
    }

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
    const before = readState();
    const remaining = before.pluginTargets.filter((target) => target !== name);
    const r = reconcile(
      remaining.filter((target) => COMPOSE_TARGETS.includes(target)),
      [name],
    );
    for (const l of r.log) log(l);
    if (r.errors || r.incomplete || r.unresolved) {
      log('INCOMPLETE — live bytes could not be reconciled safely; target remains installed');
      process.exitCode = 1;
      return true;
    }
    const state = removePluginTargets([name]);
    log(r.restored ? `restored ${r.restored} file(s)` : 'nothing to restore (not installed)');
    if (isEmpty(state)) {
      const h = removeHook();
      if (h.removed) log('nothing left installed — SessionStart hook removed');
    }
    return true;
  }

  if (action === 'status') {
    const state = readState();
    const retirement = state.retired[name];
    if (retirement) {
      log(`RETIRED on ${retirement.at}: ${retirement.reason}`);
      log(`evidence: ${retirement.evidence}`);
      if (retirement.issue) log(`upstream: ${retirement.issue}`);
      return true;
    }
    const installed = state.pluginTargets.includes(name);
    const s = statusComposed([name])[name] || { files: 0, patched: 0 };
    log(`${s.patched}/${s.files} file(s) patched — ${installed ? 'tracked (re-applied on session start + monitor)' : `NOT tracked (run \`${name} install\` so it survives /plugin update)`}`);
    return true;
  }

  return false;
}

// The top-level CLI lock is intentionally broad enough to serialize `all`, but
// callers can invoke this exported command directly. Defend that path too so a
// state change and the composed vendor-file rebuild can never interleave.
export function runPluginCommand(name, action) {
  if (action === 'install' || action === 'init'
      || action === 'uninstall' || action === 'remove') {
    return withPatchMutationLock(() => runPluginCommandUnlocked(name, action));
  }
  return runPluginCommandUnlocked(name, action);
}
