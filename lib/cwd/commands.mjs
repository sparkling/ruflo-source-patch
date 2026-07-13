// Patch targets: cwd | daemon | memory (and `all`).
//
// Each installs and uninstalls INDEPENDENTLY. Install/uninstall mutates the target
// list in state.json, then asks the patcher to make the library match it exactly —
// so `memory uninstall` removes the write lock while leaving `cwd`'s anchoring in
// the same file untouched.
//
// Actions: install|init · uninstall|remove · patch · revert · status

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { apply, inspect, PATCH_TARGETS, TARGET_INFO } from './patch-library.mjs';
import { readState, addTargets, removeTargets, migrateLegacyState } from './state.mjs';
import { installHook, removeHook } from './hooks.mjs';
import { STABLE_LIB, SETTINGS_PATH, HOOK_MARKER, NPX_ROOT, STATE_PATH } from './paths.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const log = (t, m) => console.log(`[${t}] ${m}`);

// Copy this module's dir (*.mjs) into the stable runtime dir so the always-firing
// SessionStart hook never depends on the volatile npx cache.
function syncStableCopy() {
  fs.mkdirSync(STABLE_LIB, { recursive: true });
  for (const f of fs.readdirSync(__dirname)) {
    if (f.endsWith('.mjs')) fs.copyFileSync(path.join(__dirname, f), path.join(STABLE_LIB, f));
  }
}

function report(t, r) {
  for (const l of r.log) log(t, l);
  const bits = [];
  if (r.patched) bits.push(`patched ${r.patched}`);
  if (r.reverted) bits.push(`reverted ${r.reverted}`);
  if (r.skipped) bits.push(`skipped ${r.skipped}`);
  log(t, bits.length ? bits.join(', ') : 'nothing to do');
}

// `targets` is the subset this invocation acts on: ['cwd'], or all of them for `all`.
export function patchCommand(targets, action) {
  const t = targets.length === PATCH_TARGETS.length ? 'all' : targets.join('+');

  if (action === 'install' || action === 'init') {
    syncStableCopy();
    const state = addTargets(targets);
    const h = installHook();
    log(t, h.added ? 'registered SessionStart hook' : 'SessionStart hook already present');
    report(t, apply(state.patchTargets));
    log(t, `installed targets: ${state.patchTargets.join(', ') || '(none)'}`);
  } else if (action === 'uninstall' || action === 'remove') {
    const state = removeTargets(targets);
    // Make the library match what REMAINS — this un-applies only the removed target,
    // even when another target patches the same file.
    report(t, apply(state.patchTargets));
    if (state.patchTargets.length === 0) {
      const h = removeHook();
      log(t, h.removed ? `removed ${h.removed} SessionStart hook(s)` : 'no hook to remove');
      log(t, 'no patch targets left — hook removed (delete ~/.ruflo-source-patch to fully clean up)');
    } else {
      log(t, `still installed: ${state.patchTargets.join(', ')} (hook kept)`);
    }
  } else if (action === 'patch') {
    // Re-apply the installed set (what the SessionStart hook does).
    report(t, apply(readState().patchTargets));
  } else if (action === 'revert') {
    // Unpatch the library on disk WITHOUT changing intent — the hook re-applies next
    // session. To remove permanently, use `uninstall`.
    report(t, apply([]));
    log(t, 'library reverted on disk; state unchanged (hook re-applies next session)');
  } else if (action === 'status') {
    const state = readState();
    const found = inspect();
    let settings = {};
    try { settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); } catch { /* none */ }
    const hooked = (settings.hooks?.SessionStart || []).some((g) =>
      (g.hooks || []).some((h) => h && h[HOOK_MARKER] === true));

    log(t, `npx root: ${NPX_ROOT}`);
    log(t, `state:    ${STATE_PATH}`);
    log(t, `hook:     ${hooked ? 'installed' : 'not installed'}`);
    for (const target of PATCH_TARGETS) {
      const on = state.patchTargets.includes(target);
      const f = found[target];
      log(t, `  ${on ? '✔' : '·'} ${target.padEnd(6)} ${f.patched}/${f.files} file(s) patched — ${TARGET_INFO[target]}`);
    }
  } else {
    return false;
  }
  return true;
}

// Used by the SessionStart hook: re-apply exactly the installed set.
export function reapply() {
  const anyPatched = Object.values(inspect()).some((x) => x.patched > 0);
  const state = migrateLegacyState(anyPatched);
  if (!state.patchTargets.length) return;
  apply(state.patchTargets);
}
