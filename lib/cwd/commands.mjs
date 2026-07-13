// Patch targets: cwd | daemon | memory (and `all`).
//
// Each installs and uninstalls INDEPENDENTLY. Install/uninstall mutates the target
// list in state.json, then asks the patcher to make the library match it exactly —
// so `memory uninstall` removes the write lock while leaving `cwd`'s anchoring in
// the same file untouched.
//
// Actions: install|init · uninstall|remove · status

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { apply, inspect, PATCH_TARGETS, TARGET_INFO } from './patch-library.mjs';
import { readState, addTargets, removeTargets, isEmpty } from './state.mjs';
import { installHook, removeHook } from './hooks.mjs';
import {
  installMonitor, uninstallMonitor, monitorScheduled, checkDrift, runOnce, lastRun, healMonitor, MONITOR_LOG,
} from './monitor.mjs';
import { applyPlugins, inspectPlugins, PLUGIN_TARGETS, PLUGIN_INFO } from '../plugin-registry.mjs';
import { monitorHealthProblems } from './health.mjs';
import { isProblem } from './problems.mjs';
import { syncLibFrom } from './stable.mjs';
import { STABLE_LIB, SETTINGS_PATH, HOOK_MARKER, NPX_ROOT, STATE_PATH } from './paths.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const LIB_ROOT = path.dirname(__dirname); // repo lib/

const log = (t, m) => console.log(`[${t}] ${m}`);

// Copy the runtime modules into the stable dir so the always-firing SessionStart hook
// (and the monitor) never depend on the volatile npx cache.
//
// Mirrors the repo layout instead of flattening it: the plugin patchers live in their
// own directories and import across them (`../cwd/paths.mjs`), and a flat copy would
// break those specifiers at exactly the moment they matter — inside the hook, where the
// failure is invisible. Copy the same shape, and the same import graph just works.
export function syncStableCopy() {
  // Mirror EVERY module, via the one shared routine (stable.mjs) that the monitor's self-heal
  // also uses. This used to enumerate three subtrees by name — so lib/dual never reached the
  // stable copy at all, and the freshness check added alongside it would have called that
  // absence permanent drift. The writers and the checker must agree on what belongs here.
  syncLibFrom(LIB_ROOT);

  // Migration, in this order for a reason.
  //
  // The stable copy used to be FLAT (~/.ruflo-source-patch/lib/*.mjs). Installs from that
  // era left a full set of modules at the root, and the scheduler still records an
  // absolute path to the old `lib/monitor-run.mjs`. Deleting those files before fixing the
  // schedule would point launchd/cron at nothing — a watchdog that fails silently, which
  // is worse than no watchdog. So: re-register the schedule FIRST, then remove the
  // orphans. (The SessionStart hook self-heals in installHook() for the same reason.)
  try { healMonitor(); } catch { /* best-effort: a broken schedule must not block a patch */ }
  pruneLegacyFlatCopy();
}

// Remove root-level modules superseded by their lib/cwd/ counterparts. Only ever deletes
// a root file that now EXISTS under cwd/ — anything genuinely rooted at lib/ (the plugin
// registry) is left alone.
function pruneLegacyFlatCopy() {
  const cwdDir = path.join(STABLE_LIB, 'cwd');
  if (!fs.existsSync(cwdDir)) return;
  const owned = new Set(fs.readdirSync(cwdDir).filter((f) => f.endsWith('.mjs')));
  for (const f of fs.readdirSync(STABLE_LIB)) {
    if (f.endsWith('.mjs') && owned.has(f)) {
      try { fs.rmSync(path.join(STABLE_LIB, f), { force: true }); } catch { /* ignore */ }
    }
  }
}

// Re-apply EVERYTHING the user has installed — CLI patch targets and plugin patches
// alike. Both the SessionStart hook and the monitor call this; neither should have to
// know which engine owns which target.
export function applyInstalled(state = readState()) {
  const cli = apply(state.patchTargets);
  const plug = applyPlugins(state.pluginTargets);
  const log = [...cli.log, ...plug.log];
  return {
    patched: cli.patched + plug.patched,
    unchanged: cli.unchanged + plug.unchanged,
    skipped: (cli.skipped || 0) + (plug.skipped || 0),
    incomplete: plug.incomplete || 0,
    errors: (cli.errors || 0) + (plug.errors || 0),
    rebaselined: log.filter((l) => l.includes('re-baselined')).length,
    log,
  };
}

// Anything a human needs to look at. An edit that no longer applies, or a vendor file that
// changed under us, means the patch may be silently doing nothing — and a patch that
// silently does nothing is the exact failure this whole project exists to prevent. The
// SessionStart hook surfaces this; the monitor logs it.
export function problemsIn(r) {
  // isProblem() is shared with the monitor and the notifier — see problems.mjs. It used to be
  // a regex literal here, one of three copies that disagreed about what a problem was.
  return r.log.filter(isProblem);
}

function report(t, r) {
  for (const l of r.log) log(t, l);
  const bits = [];
  if (r.patched) bits.push(`patched ${r.patched}`);
  if (r.restored) bits.push(`restored ${r.restored}`);
  if (r.skipped) bits.push(`skipped ${r.skipped}`);
  // Errors last, so they are the final thing on the line. Without this, a run in which EVERY
  // file threw printed `nothing to do` — patched and skipped are both 0 — and exited 0.
  if (r.errors) bits.push(`ERRORS ${r.errors}`);
  log(t, bits.length ? bits.join(', ') : 'nothing to do');
  // A failed patch is not a successful run. Exit code is the only signal `make install` and
  // any CI gate can actually see.
  if (r.errors) process.exitCode = 1;
}

// `targets` is the single target this invocation acts on (an array for historical reasons
// — the engine takes a set, and `apply()` still does).
export function patchCommand(targets, action) {
  const t = targets.join('+');

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
    // The hook serves plugin patches too, so it only goes when NOTHING is left.
    if (isEmpty(state)) {
      const h = removeHook();
      log(t, h.removed ? `removed ${h.removed} SessionStart hook(s)` : 'no hook to remove');
      log(t, 'nothing left installed — hook removed (delete ~/.ruflo-source-patch to fully clean up)');
    } else {
      const left = [...state.patchTargets, ...state.pluginTargets];
      log(t, `still installed: ${left.join(', ')} (hook kept)`);
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
    // Plugin patches share the hook and the monitor, so they belong in the same picture.
    const plug = inspectPlugins();
    for (const target of PLUGIN_TARGETS) {
      const on = state.pluginTargets.includes(target);
      const f = plug[target];
      log(t, `  ${on ? '✔' : '·'} ${target.padEnd(6)} ${f.patched}/${f.files} file(s) patched — ${PLUGIN_INFO[target]}`);
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
    if (!r.ok) {
      // A monitor that failed to schedule is the single most dangerous thing to report as OK:
      // every other warning this package emits is delivered BY the monitor, so its silence
      // becomes indistinguishable from health. Say why, and fail.
      log(t, r.why || 'could not schedule the monitor (no reason reported)');
      process.exitCode = 1;
      return true;
    }
    log(t, `scheduled via ${r.how} every ${r.secs}s — ${r.where}`);
    const s = readState();
    const watching = [...s.patchTargets, ...s.pluginTargets];
    log(t, `re-applies: ${watching.join(', ') || '(nothing installed yet)'}`);
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
    if (d.staleLib === null) {
      log(t, 'stable:    unknown — no global install to compare against (npx-only usage)');
    } else if (d.staleLib.length) {
      log(t, `STALE LIB: ${d.staleLib.length} module(s) behind the installed package — the hook and monitor are running OLD code`);
      log(t, `           ${d.staleLib.join(', ')}`);
    } else {
      log(t, 'stable:    current — hook and monitor run the installed package');
    }
    for (const h of monitorHealthProblems()) log(t, `HEALTH:    ${h}`);
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
    // A stale stable copy fails the gate too. The patches can be perfectly applied while the
    // thing that applies them is a version behind — "no drift" would be true of the patches
    // and a lie about the system.
    const stale = d.staleLib && d.staleLib.length ? d.staleLib : [];
    for (const m of stale) log(t, `STALE-LIB ${m} — stable copy is behind the installed package`);
    if (d.drifting.length || stale.length) {
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

// Used by the SessionStart hook: re-apply exactly the installed set — CLI patch targets
// AND plugin patches. The plugin half is what catches a `/plugin update`, which drops the
// ruflo-adr patches without a word.
export function reapply() {
  const state = readState();
  if (isEmpty(state)) return null;
  return applyInstalled(state);
}
