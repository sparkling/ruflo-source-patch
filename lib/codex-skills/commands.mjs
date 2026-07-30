// Lifecycle for the two independently retireable Codex command-parity targets.

import { apply, expectedFiles, restore, status } from './patcher.mjs';
import {
  addPluginTargets, isEmpty, readState, removePluginTargets, withPatchMutationLock,
} from '../cwd/state.mjs';
import { installHook, removeHook } from '../cwd/hooks.mjs';
import { syncStableCopy } from '../cwd/commands.mjs';

function runUnlocked(target, action) {
  const log = (message) => console.log(`[${target}] ${message}`);

  if (action === 'install' || action === 'init') {
    syncStableCopy();
    addPluginTargets([target]);
    const hook = installHook();
    if (hook.added) log('registered SessionStart re-apply hook');
    else if (hook.updated) log('SessionStart re-apply hook path refreshed');

    const result = apply(target);
    for (const line of result.log) log(line);
    log(`patched: ${result.patched}, unchanged: ${result.unchanged}${result.incomplete ? `, INCOMPLETE: ${result.incomplete}` : ''}${result.errors ? `, ERRORS: ${result.errors}` : ''}`);
    if (result.incomplete || result.errors) {
      log('INCOMPLETE — target remains tracked so SessionStart and the monitor can retry');
      process.exitCode = 1;
    } else {
      log('installed in the active Codex plugin cache; start a new Codex session to load the skills');
    }
    return true;
  }

  if (action === 'uninstall' || action === 'remove') {
    const result = restore(target);
    for (const line of result.log) log(line);
    if (result.incomplete || result.errors) {
      log('INCOMPLETE — artifacts could not be restored safely; target remains tracked');
      process.exitCode = 1;
      return true;
    }
    const state = removePluginTargets([target]);
    log(`restored: ${result.restored}, preserved: ${result.preserved}`);
    if (isEmpty(state)) {
      const hook = removeHook();
      if (hook.removed) log('nothing left installed — SessionStart re-apply hook removed');
    }
    return true;
  }

  if (action === 'status') {
    const state = readState();
    const retirement = state.retired[target];
    if (retirement) {
      log(`RETIRED on ${retirement.at}: ${retirement.reason}`);
      log(`evidence: ${retirement.evidence}`);
      if (retirement.issue) log(`upstream: ${retirement.issue}`);
      return true;
    }
    const result = status(target);
    const tracked = state.pluginTargets.includes(target);
    for (const line of result.log) log(line);
    log(`${result.patched}/${result.files} component(s) ready — ${tracked ? 'tracked (re-applied on SessionStart + monitor)' : `NOT tracked (run \`${target} install\`)`}`);
    return true;
  }

  return false;
}

function command(target, action) {
  if (['install', 'init', 'uninstall', 'remove'].includes(action)) {
    return withPatchMutationLock(() => runUnlocked(target, action));
  }
  return runUnlocked(target, action);
}

export const rufloCodexSkillsCommand = (action) => command('ruflo-codex-skills', action);
export const brainCodexSkillsCommand = (action) => command('brain-codex-skills', action);

export const CODEX_SKILL_COMPONENTS = {
  'ruflo-codex-skills': expectedFiles('ruflo-codex-skills'),
  'brain-codex-skills': expectedFiles('brain-codex-skills'),
};
