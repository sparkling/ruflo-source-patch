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
import { spawnSync } from 'node:child_process';
import { apply, inspect, PATCH_TARGETS, TARGET_INFO, pluginHostCommandFiles } from './patch-library.mjs';
import {
  readState, addTargets, removeTargets, isEmpty, withPatchMutationLock,
} from './state.mjs';
import { installHook, removeHook } from './hooks.mjs';
import { retireSuperseded } from '../supersede.mjs';
import {
  installMonitor, uninstallMonitor, monitorScheduled, checkDrift, runOnce, lastRun, healMonitor, appendLog, MONITOR_LOG,
} from './monitor.mjs';
import { applyPlugins, inspectPlugins, PLUGIN_TARGETS, PLUGIN_INFO } from '../plugin-registry.mjs';
import { recoverStaleWriters } from './stale-writer.mjs';
import { monitorHealthProblems } from './health.mjs';
import { isProblem } from './problems.mjs';
import { syncLibFrom, pruneStaleModules } from './stable.mjs';
import { STABLE_LIB, SETTINGS_PATH, HOOK_MARKER, NPX_ROOT, STATE_PATH } from './paths.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const LIB_ROOT = path.dirname(__dirname); // repo lib/

const log = (t, m) => console.log(`[${t}] ${m}`);
let hostAutoUpdateRan = false;

function autoUpdateHostPlugins() {
  if (hostAutoUpdateRan || process.env.RSP_NO_HOST_AUTO_UPDATE === '1') {
    return { updated: 0, current: 0, skipped: true, errors: 0, log: [] };
  }
  hostAutoUpdateRan = true;
  const files = pluginHostCommandFiles();
  if (!files.length) {
    return { updated: 0, current: 0, errors: 1, log: ['automatic host update unavailable: no patched Ruflo plugins command was found'] };
  }

  const marker = '__RSP_HOST_UPDATE_RESULT__';
  const source = `
import { pathToFileURL } from 'node:url';
try {
  const module = await import(pathToFileURL(process.argv[1]).href);
  const command = module.pluginsCommand?.subcommands?.find((item) => item.name === 'host-update');
  if (!command) throw new Error('patched host-update command is absent');
  const result = await command.action({ flags: { format: 'json' } });
  process.stdout.write(${JSON.stringify(marker)} + JSON.stringify(result) + '\\n');
} catch (error) {
  process.stderr.write(String(error?.stack || error) + '\\n');
  process.exit(2);
}`;

  let failure = 'no patched command module could be executed';
  for (const file of files) {
    const run = spawnSync(process.execPath, ['--input-type=module', '--eval', source, file], {
      encoding: 'utf8', timeout: 10 * 60 * 1000, maxBuffer: 32 * 1024 * 1024,
    });
    const at = String(run.stdout || '').lastIndexOf(marker);
    if (run.status !== 0 || at < 0) {
      failure = String(run.stderr || run.stdout || `exit ${run.status}`).trim();
      continue;
    }
    try {
      const response = JSON.parse(String(run.stdout).slice(at + marker.length).trim());
      const data = response.data || {};
      const states = (data.entries || []).flatMap((entry) => Object.values(entry.hosts || {}));
      const updated = states.filter((state) => ['updated', 'refreshed'].includes(state.status)).length;
      const current = states.filter((state) => state.status === 'current').length;
      const preserved = states.filter((state) => state.status.startsWith('preserved-')).length;
      if (!response.success) {
        const failed = (data.entries || []).flatMap((entry) => Object.entries(entry.hosts || {})
          .filter(([, state]) => state.status === 'failed')
          .map(([host, state]) => `${entry.pluginId}/${host}: ${state.error}`));
        return { updated, current, errors: 1, log: [`automatic host update failed: ${failed.join('; ') || data.error || 'unknown failure'}`] };
      }
      return {
        updated, current, errors: 0,
        log: [(updated
          ? `updated ${updated} stale Ruflo host plugin copy(ies); restart Claude Code and Codex sessions to load them`
          : `all ${current} active Ruflo host plugin copy(ies) already match the refreshed marketplaces`)
          + (preserved ? `; preserved ${preserved} disabled, managed, or orphaned-project registration(s)` : '')],
      };
    } catch (error) {
      failure = `invalid host-update result from ${file}: ${error.message}`;
    }
  }
  return { updated: 0, current: 0, errors: 1, log: [`automatic host update failed: ${failure}`] };
}

function reportHostAutoUpdate(target = 'plugin-hosts') {
  const result = autoUpdateHostPlugins();
  for (const line of result.log) log(target, line);
  if (result.errors) process.exitCode = 1;
  return result;
}

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

  // THEN reap what the package no longer ships — in this order, for a reason.
  //
  // The stable copy used to be FLAT (~/.ruflo-source-patch/lib/*.mjs). Installs from that era left
  // a full set of modules at the root, and a scheduler registered back then still records an
  // absolute path to the old `lib/monitor-run.mjs`. Deleting that file before fixing the schedule
  // would point launchd/cron at nothing — a watchdog that fails silently, which is worse than no
  // watchdog. So: re-register the schedule FIRST, then reap. (installHook() self-heals a drifted
  // hook command for the same reason.)
  // A broken schedule must not block a patch — but it must not vanish silently either. Record both a
  // heal that FIRED (the schedule was broken and we re-registered) and one that THREW (ADR-021).
  try {
    const h = healMonitor();
    if (h && h.healed) appendLog(`HEALED monitor on session start (${h.reason})`);
    else if (h && h.reason && h.why) appendLog(`HEAL-FAILED monitor on session start (${h.reason}): ${h.why}`);
  } catch (e) { appendLog(`HEAL-ERROR healMonitor threw on session start: ${e && e.message ? e.message : e}`); }
  pruneStaleModules(LIB_ROOT);
}

// Re-apply EVERYTHING the user has installed — CLI patch targets and plugin patches
// alike. Both the SessionStart hook and the monitor call this; neither should have to
// know which engine owns which target.
function applyInstalledUnlocked(state) {
  // Stand down anything upstream now genuinely does — BEFORE re-applying, or we would faithfully
  // re-patch the target we are about to retire. Mutating path, so it is allowed to act; `status` and
  // `monitor check` only ever report. See supersede.mjs for why this is a local probe and not a
  // published list of "fixed" issues.
  const sup = retireSuperseded(state);
  if (sup.retired > 0) state = readState();

  const cli = apply(state.patchTargets);
  const plug = applyPlugins(state.pluginTargets);
  const log = [...sup.log, ...cli.log, ...plug.log];
  return {
    patched: cli.patched + plug.patched,
    unchanged: cli.unchanged + plug.unchanged,
    skipped: (cli.skipped || 0) + (plug.skipped || 0),
    incomplete: (cli.incomplete || 0) + (plug.incomplete || 0),
    errors: (cli.errors || 0) + (plug.errors || 0),
    retired: sup.retired,
    rebaselined: log.filter((l) => l.includes('re-baselined')).length,
    log,
  };
}

export function applyInstalled(state) {
  return withPatchMutationLock(() => applyInstalledUnlocked(state ?? readState()));
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
  if (r.incomplete) bits.push(`INCOMPLETE ${r.incomplete}`);
  // Errors last, so they are the final thing on the line. Without this, a run in which EVERY
  // file threw printed `nothing to do` — patched and skipped are both 0 — and exited 0.
  if (r.errors) bits.push(`ERRORS ${r.errors}`);
  log(t, bits.length ? bits.join(', ') : 'nothing to do');
  // A failed patch is not a successful run. Exit code is the only signal `make install` and
  // any CI gate can actually see.
  if (r.errors || r.incomplete) process.exitCode = 1;
}

// `targets` is the single target this invocation acts on (an array for historical reasons
// — the engine takes a set, and `apply()` still does).
function patchCommandUnlocked(targets, action) {
  const t = targets.join('+');

  if (action === 'install' || action === 'init') {
    syncStableCopy();
    const state = addTargets(targets);
    const h = installHook();
    log(t, h.added ? 'registered SessionStart hook' : 'SessionStart hook already present');
    const applied = apply(state.patchTargets);
    report(t, applied);
    if (targets.includes('plugin-hosts') && !applied.errors && !applied.incomplete) reportHostAutoUpdate(t);
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
      const healthy = f.files > 0 && f.satisfied === f.files;
      const detail = `${f.satisfied}/${f.files} file(s) satisfied (${f.patched} patched, ${f.native} native)`;
      log(t, `  ${on ? (healthy ? '✔' : '✘') : '·'} ${target.padEnd(6)} ${detail} — ${TARGET_INFO[target]}`);
      if (on && !healthy) process.exitCode = 1;
    }
    // Plugin patches share the hook and the monitor, so they belong in the same picture.
    const plug = inspectPlugins();
    for (const target of PLUGIN_TARGETS) {
      const on = state.pluginTargets.includes(target);
      const f = plug[target];
      const healthy = f.files > 0 && f.patched === f.files;
      log(t, `  ${on ? (healthy ? '✔' : '✘') : '·'} ${target.padEnd(6)} ${f.patched}/${f.files} file(s) patched — ${PLUGIN_INFO[target]}`);
      if (on && !healthy) process.exitCode = 1;
    }
  } else {
    return false;
  }
  return true;
}

// The CLI takes one broad, re-entrant lock across `all`, but this exported
// command is also used directly by tests and library consumers. Keep its own
// mutating contract complete: desired state and the vendor bytes derived from
// it are one transaction regardless of the caller.
export function patchCommand(targets, action) {
  if (action === 'install' || action === 'init'
      || action === 'uninstall' || action === 'remove') {
    return withPatchMutationLock(() => patchCommandUnlocked(targets, action));
  }
  return patchCommandUnlocked(targets, action);
}

// Target: monitor — keeps the patches live between sessions (a new npx copy, or a
// `ruflo update`, silently replaces a patched file; the SessionStart hook only fires
// at session start, so that copy runs unpatched until you restart Claude Code).
export function monitorCommand(action) {
  const t = 'monitor';

  if (action === 'install' || action === 'init') {
    syncStableCopy(); // make sure monitor-run.mjs exists at the stable path
    const state = readState();
    if (state.patchTargets.includes('plugin-hosts')) {
      const applied = apply(state.patchTargets);
      report(t, applied);
      if (!applied.errors && !applied.incomplete) reportHostAutoUpdate(t);
    }
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
      log(t, d.stableLibSource === 'mutable-checkout'
        ? 'stable:    manual — source is a mutable Git checkout; timer auto-heal is disabled until an explicit install'
        : 'stable:    unknown — no immutable installed source is available for comparison');
    } else if (d.staleLib.length) {
      log(t, `STALE LIB: ${d.staleLib.length} module(s) behind the installed package — the hook and monitor are running OLD code`);
      log(t, `           ${d.staleLib.join(', ')}`);
    } else {
      log(t, 'stable:    current — hook and monitor run the installed package');
    }
    const health = monitorHealthProblems();
    for (const h of health) log(t, `HEALTH:    ${h}`);
    for (const u of d.uncovered) log(t, `WARN ${u}`);
    const l = lastRun();
    log(t, `last log:  ${l || '(nothing logged yet — it only logs when it repairs something)'}`);
    if (s.stale || d.drifting.length || (d.staleLib && d.staleLib.length)
        || d.uncovered.length || health.length) process.exitCode = 1;
  } else if (action === 'run') {
    const r = runOnce();
    if (r.skipped) log(t, 'no patch targets installed — nothing to do');
    else log(t, r.repaired ? `repaired ${r.repaired} file(s)` : `steady state (${r.unchanged} file(s) already correct)`);
    // Same stale-writer recovery the scheduled tick runs. Only eligible daemons are restarted;
    // an MCP transport belongs to its host and is reported for controlled reconnection (ADR-023).
    const rec = recoverStaleWriters();
    for (const line of rec.log) log(t, line);
    if (r.errors || r.incomplete) process.exitCode = 1;
  } else if (action === 'check') {
    const d = checkDrift();
    for (const u of d.uncovered) log(t, `WARN ${u}`);
    // A stale stable copy fails the gate too. The patches can be perfectly applied while the
    // thing that applies them is a version behind — "no drift" would be true of the patches
    // and a lie about the system.
    const stale = d.staleLib && d.staleLib.length ? d.staleLib : [];
    for (const m of stale) log(t, `STALE-LIB ${m} — stable copy is behind the installed package`);
    if (d.drifting.length || stale.length || d.uncovered.length) {
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
  return withPatchMutationLock(() => {
    const state = readState();
    if (isEmpty(state)) return null;
    return applyInstalledUnlocked(state);
  });
}
