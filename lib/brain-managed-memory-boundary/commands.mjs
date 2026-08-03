// Lifecycle for the Brain #102/#103 managed AgentDB boundary target.

import { apply, restore, status } from './patcher.mjs';
import {
  addPluginTargets, removePluginTargets, readState, isEmpty, withPatchMutationLock,
} from '../cwd/state.mjs';
import { installHook, removeHook } from '../cwd/hooks.mjs';
import { syncStableCopy } from '../cwd/commands.mjs';

const TARGET = 'brain-managed-memory-boundary';

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
      log('INCOMPLETE — nothing partial is trusted; the target stays tracked so the monitor can retry after native activation finishes');
      process.exitCode = 1;
    } else {
      log('raw managed-store refusal is live through the Stable Spine now');
      log('ACTION REQUIRED — reconnect the Brain MCP or start a new host session before relying on agentdb_diagnostic_read');
    }
    return true;
  }

  if (action === 'uninstall' || action === 'remove') {
    const result = restore();
    for (const line of result.log) log(line);
    if (result.incomplete || result.errors) {
      log('INCOMPLETE — exact restoration could not be proved; target remains installed');
      process.exitCode = 1;
      return true;
    }
    const state = removePluginTargets([TARGET]);
    log(result.restored ? `restored ${result.restored} owned executable/artifact(s)` : 'nothing owned was present');
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
    const result = status();
    for (const line of result.log) log(line);
    const tracked = state.pluginTargets.includes(TARGET);
    log(`${result.patched}/${result.files} current/owned Brain component(s) ready — ${tracked ? 'tracked (re-applied after native updates by SessionStart + monitor)' : `NOT tracked (run \`${TARGET} install\`)`}`);
    return true;
  }
  return false;
}

export function brainManagedMemoryBoundaryCommand(action) {
  if (['install', 'init', 'uninstall', 'remove'].includes(action)) {
    return withPatchMutationLock(() => runUnlocked(action));
  }
  return runUnlocked(action);
}
