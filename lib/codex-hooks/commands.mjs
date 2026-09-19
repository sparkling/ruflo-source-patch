// Command lifecycle for the additive RuvNet Brain Codex hook target (#52).

import { apply, restore, status } from './patcher.mjs';
import {
  addPluginTargets, removePluginTargets, readState, isEmpty, withPatchMutationLock,
} from '../cwd/state.mjs';
import { installHook, removeHook } from '../cwd/hooks.mjs';
import { syncStableCopy } from '../cwd/commands.mjs';

const TARGET = 'codex-hooks';

function runUnlocked(action) {
  const log = (message) => console.log(`[${TARGET}] ${message}`);

  if (action === 'install' || action === 'init') {
    syncStableCopy();
    addPluginTargets([TARGET]);
    const hook = installHook();
    if (hook.added) log('registered SessionStart re-apply hook');
    else if (hook.updated) log('SessionStart re-apply hook path refreshed');

    const result = apply();
    for (const line of result.log) log(line);
    log(`patched: ${result.patched}, unchanged: ${result.unchanged}${result.incomplete ? `, INCOMPLETE: ${result.incomplete}` : ''}${result.errors ? `, ERRORS: ${result.errors}` : ''}`);
    if (result.incomplete || result.errors) {
      log('INCOMPLETE — target remains tracked so SessionStart and the monitor can retry; do not assume Brain lifecycle hooks are active');
      process.exitCode = 1;
    } else if (result.log.some((line) => line.includes('explicitly retired automatic Codex lifecycle hooks'))) {
      log('Brain has withdrawn automatic Codex hooks; no hook trust action is required');
    } else {
      log('ACTION REQUIRED — hook definitions are installed, but Codex will not run changed definitions until you review them');
      log('start a new Codex session, run /hooks, verify the pending source is ruvnet-brain@ruvnet-brain, then trust only those Brain definitions');
    }
    return true;
  }

  if (action === 'uninstall' || action === 'remove') {
    const result = restore();
    for (const line of result.log) log(line);
    if (result.errors || result.incomplete || result.unresolved) {
      log('INCOMPLETE — registration/artifacts could not be removed safely; target remains installed');
      process.exitCode = 1;
      return true;
    }

    const state = removePluginTargets([TARGET]);
    log(result.restored ? `restored ${result.restored} owned artifact(s)/registration(s)` : 'nothing owned was present');
    if (isEmpty(state)) {
      const hook = removeHook();
      if (hook.removed) log('nothing left installed — SessionStart re-apply hook removed');
    }
    return true;
  }

  if (action === 'status') {
    const state = readState();
    const retirement = state.retired[TARGET];
    if (retirement) {
      log(`RETIRED on ${retirement.at}: ${retirement.reason}`);
      log(`evidence: ${retirement.evidence}`);
      if (retirement.issue) log(`upstream: ${retirement.issue}`);
      return true;
    }
    const tracked = state.pluginTargets.includes(TARGET);
    const result = status();
    for (const line of result.log) log(line);
    log(`${result.patched}/${result.files} Codex lifecycle component(s) ready — ${tracked ? 'tracked (re-applied on SessionStart + monitor)' : `NOT tracked (run \`${TARGET} install\`)`}`);
    return true;
  }

  return false;
}

export function codexHooksCommand(action) {
  if (action === 'install' || action === 'init'
      || action === 'uninstall' || action === 'remove') {
    return withPatchMutationLock(() => runUnlocked(action));
  }
  return runUnlocked(action);
}
