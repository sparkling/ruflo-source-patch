// Patch targets: cwd | daemon | memory (and `all`).
//
// Each installs and uninstalls INDEPENDENTLY. Install/uninstall mutates the target
// list in state.json, then asks the patcher to make the library match it exactly —
// so `memory uninstall` removes the write lock while leaving `cwd`'s anchoring in
// the same file untouched.
//
// Actions: install|init · uninstall|remove · status
//
// `patch` and `revert` are DEPRECATED aliases for install/uninstall. They existed before
// per-target state, when they simply meant "apply/unapply the files". `revert` left the
// library byte-identical to what `uninstall` leaves, so it was uninstall with extra
// bookkeeping — and the "paused" state it needed shipped two bugs (it ignored its target
// argument, and the monitor undid it within one tick). Deleted, aliased for old scripts.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { apply, inspect, PATCH_TARGETS, TARGET_INFO } from './patch-library.mjs';
import { readState, addTargets, removeTargets, migrateLegacyState } from './state.mjs';
import { installHook, removeHook } from './hooks.mjs';
import {
  installMonitor, uninstallMonitor, monitorScheduled, checkDrift, runOnce, lastRun, MONITOR_LOG,
} from './monitor.mjs';
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

// Target: monitor — keeps the patches live between sessions (a new npx copy, or a
// `ruflo update`, silently replaces a patched file; the SessionStart hook only fires
// at session start, so that copy runs unpatched until you restart Claude Code).
export function monitorCommand(action) {
  const t = 'monitor';

  if (action === 'install' || action === 'init') {
    syncStableCopy(); // make sure monitor-run.mjs exists at the stable path
    const r = installMonitor();
    if (!r.ok) { log(t, r.why); return true; }
    log(t, `scheduled via ${r.how} every ${r.secs}s — ${r.where}`);
    log(t, `re-applies: ${readState().patchTargets.join(', ') || '(no patch targets installed yet)'}`);
    log(t, `log: ${MONITOR_LOG}`);
  } else if (action === 'uninstall' || action === 'remove') {
    const r = uninstallMonitor();
    log(t, r.removed ? `removed (${r.how})` : `nothing scheduled (${r.how})`);
  } else if (action === 'status') {
    const s = monitorScheduled();
    const d = checkDrift();
    log(t, `scheduled: ${s.scheduled ? `yes (${s.how})` : 'no'}${s.where ? ` — ${s.where}` : ''}`);
    if (s.stale) log(t, `BROKEN:    ${s.stale}`);
    log(t, `watching:  ${d.installed.join(', ') || '(no patch targets installed)'}`);
    log(t, d.drifting.length ? `DRIFT:     ${d.drifting.join('; ')}` : 'drift:     none — all installed targets are live');
    for (const u of d.uncovered) log(t, `WARN ${u}`);
    const l = lastRun();
    log(t, `last log:  ${l || '(nothing logged yet — it only logs when it repairs something)'}`);
  } else if (action === 'run') {
    const r = runOnce();
    if (r.skipped) log(t, 'no patch targets installed — nothing to do');
    else log(t, r.repaired ? `repaired ${r.repaired} file(s)` : `steady state (${r.unchanged} file(s) already correct)`);
  } else if (action === 'check') {
    const d = checkDrift();
    for (const u of d.uncovered) log(t, `WARN ${u}`);
    if (d.drifting.length) {
      for (const x of d.drifting) log(t, `DRIFT ${x}`);
      process.exitCode = 1; // usable as a CI / pre-flight gate
    } else {
      log(t, `ok — ${d.installed.join(', ') || 'nothing'} live, no drift`);
    }
  } else {
    return false;
  }
  return true;
}

// Used by the SessionStart hook: re-apply exactly the installed set.
// Honours the `revert` pause, exactly like the monitor — otherwise a revert would come
// back at the next session start instead of the next monitor tick, which is no better.
export function reapply() {
  const anyPatched = Object.values(inspect()).some((x) => x.patched > 0);
  const state = migrateLegacyState(anyPatched);
  if (!state.patchTargets.length) return;
  apply(state.patchTargets);
}
