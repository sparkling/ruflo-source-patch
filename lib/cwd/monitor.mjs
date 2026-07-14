// Target: monitor — keep the patches live between sessions.
//
// WHY it exists: the SessionStart hook only fires when a Claude Code session STARTS.
// `npx -y ruflo@latest` fetches a NEW cache dir the moment a version changes, and a
// `ruflo update` can land mid-session — so a fresh, UNPATCHED copy can be running for
// hours while the hook sits idle until the next restart. The monitor closes that window.
//
// HOW: no resident process, no daemon. This project exists partly because ruflo daemons
// multiply; shipping another long-lived watcher would be poor taste. Instead the OS
// scheduler (launchd on macOS, cron on Linux) runs a SHORT-LIVED check on an interval.
// The check re-applies the installed target set and exits. It writes only when bytes
// actually differ, so a steady-state tick is a few stats and no I/O.
//
// Actions: install | uninstall | status | run | check
//   install    register the scheduled job (default every 5 min; RSP_MONITOR_INTERVAL)
//   uninstall  remove it
//   status     is it scheduled? when did it last run? is anything drifting right now?
//   run        the job body (re-apply + log) — what the scheduler invokes
//   check      dry-run: report drift, exit 1 if any file is not in its expected state

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { apply, inspect, scanUncoveredBuilds } from './patch-library.mjs';
import { applyPlugins, inspectPlugins } from '../plugin-registry.mjs';
import { readState, isEmpty } from './state.mjs';
import { recordProblems, isProblem, isFailure } from './problems.mjs';
import { beat, monitorHealthProblems } from './health.mjs';
import { stableLibDrift, healStableLib } from './stable.mjs';
import { MONITOR_META_PATH, HEARTBEAT_PATH } from './paths.mjs';
import { STABLE_DIR, STABLE_LIB, HOME_BASE } from './paths.mjs';

export const MONITOR_LABEL = 'com.sparkleideas.ruflo-source-patch.monitor';
export const MONITOR_LOG = path.join(STABLE_DIR, 'monitor.log');
// Mirrors the repo layout — see paths.mjs. Re-running `monitor install` rewrites the
// scheduler entry, so a move here self-heals on the next install.
const MONITOR_SCRIPT = path.join(STABLE_LIB, 'cwd', 'monitor-run.mjs');
// HOME_BASE, not os.homedir(): otherwise a sandboxed/test install would write a real
// LaunchAgent into the user's actual ~/Library/LaunchAgents.
const PLIST = path.join(HOME_BASE, 'Library', 'LaunchAgents', `${MONITOR_LABEL}.plist`);
const CRON_TAG = '# ruflo-source-patch monitor';

const DEFAULT_INTERVAL = 300; // seconds
export const interval = () => {
  const n = parseInt(process.env.RSP_MONITOR_INTERVAL || '', 10);
  return Number.isFinite(n) && n >= 30 ? n : DEFAULT_INTERVAL;
};

// ─── the job body ────────────────────────────────────────────────────────────

export function appendLog(line) {
  try {
    fs.mkdirSync(STABLE_DIR, { recursive: true });
    // Keep it small — this runs on a timer forever.
    try {
      if (fs.statSync(MONITOR_LOG).size > 256 * 1024) {
        const tail = fs.readFileSync(MONITOR_LOG, 'utf8').split('\n').slice(-200).join('\n');
        fs.writeFileSync(MONITOR_LOG, tail);
      }
    } catch { /* no log yet */ }
    fs.appendFileSync(MONITOR_LOG, `${new Date().toISOString()} ${line}\n`);
  } catch { /* best-effort */ }
}

/** Re-apply the installed set. Returns what it had to fix (empty = steady state). */
export function runOnce() {
  // Proof of life FIRST, before any work that could throw. A tick that dies halfway still
  // proves the scheduler is firing — and conflating "the monitor is dead" with "the monitor
  // hit an error" would send you looking in the wrong place.
  beat();

  const state = readState();
  if (isEmpty(state)) return { skipped: true, repaired: 0 };

  // Are WE the code the user installed? The stable copy under ~/.ruflo-source-patch/lib is what
  // this process is running, and until now nothing ever refreshed it after the first install —
  // so a package upgrade changed nothing about what the hook and this monitor actually do, in
  // total silence. Heal from the packaged modules; it lands on the next tick. (See stable.mjs;
  // returns null under npx-only usage, where there is no durable package to compare against —
  // unknown, which we do not dress up as healthy.)
  const drifted = stableLibDrift();
  if (drifted && drifted.length) {
    const { healed } = healStableLib();
    appendLog(`SELF-UPDATE stable copy was ${drifted.length} module(s) behind the installed package (${drifted.slice(0, 4).join(', ')}${drifted.length > 4 ? ', …' : ''}) — refreshed ${healed}; effective next tick`);
  }

  const cli = apply(state.patchTargets);
  if (cli.patched > 0) {
    // Something overwrote a patched file (npx fetched a new copy, or ruflo updated).
    appendLog(`REPAIRED ${cli.patched} file(s) [${state.patchTargets.join(',')}] — ${cli.log.filter((l) => l.startsWith('patched')).join(' | ')}`);
  }
  // A re-baseline means the VENDOR file changed under us and we adopted it as the new
  // pristine. Never let that pass silently: it is the moment to check the anchors still
  // hold, and it would otherwise be invisible (the repair line above looks routine).
  for (const l of cli.log.filter((l) => l.startsWith('re-baselined'))) appendLog(`REBASELINE ${l}`);

  // The plugin half. A `/plugin update` replaces ruflo-adr wholesale and drops these
  // patches silently — and a reverted adr-index patch doesn't fail loudly, it just goes
  // back to reporting success while writing nothing.
  const plug = applyPlugins(state.pluginTargets);
  if (plug.patched > 0) {
    appendLog(`REPAIRED ${plug.patched} plugin file(s) [${state.pluginTargets.join(',')}] — ${plug.log.filter((l) => !l.includes('re-baselined')).join(' | ')}`);
  }
  for (const l of plug.log.filter((l) => l.includes('re-baselined'))) appendLog(`REBASELINE ${l}`);
  if (plug.incomplete > 0) {
    appendLog(`WARN ${plug.incomplete} plugin file(s) only PARTIALLY patched — upstream shape changed; run \`adr-index status\``);
  }

  // An anchor that no longer matches means the patch is doing NOTHING to that file, while
  // `status` still says the target is installed. Previously these lines were dropped —
  // runOnce only logged entries starting with 'patched' — so the one failure that most
  // needs a human went unrecorded even here.
  // isFailure() is the SHARED predicate (problems.mjs), not a local regex: the local copy
  // missed `error …` lines, which are the ones we can least afford to drop.
  for (const l of [...cli.log, ...plug.log].filter(isFailure)) appendLog(`WARN ${l}`);

  const uncovered = scanUncoveredBuilds();
  for (const w of uncovered) appendLog(`WARN ${w}`);

  // Leave a note the notifier can pick up. The monitor is a detached job — it cannot reach
  // your session, only leave something behind. A line in monitor.log is a note nobody
  // reads; this one is surfaced on your next prompt.
  //
  // The uncovered-build scan goes in TOO. It exists because 38 daemons accumulated from a
  // package no entry covered, while `daemon status --all` reported health — and until now its
  // finding went ONLY to monitor.log, i.e. to the note nobody reads. A detector whose output
  // no one sees is not a detector.
  recordProblems([
    ...[...cli.log, ...plug.log].filter(isProblem),
    ...uncovered,
  ]);

  const repaired = cli.patched + plug.patched;
  return {
    skipped: false,
    repaired,
    unchanged: cli.unchanged + plug.unchanged,
    errors: (cli.errors || 0) + (plug.errors || 0),
    result: { cli, plug },
  };
}

// ─── drift check (no writes) ─────────────────────────────────────────────────

export function checkDrift() {
  const state = readState();
  const found = inspect();
  const plug = inspectPlugins();
  const drifting = [];
  for (const t of state.patchTargets) {
    const f = found[t];
    if (f.patched < f.files) drifting.push(`${t}: ${f.files - f.patched}/${f.files} file(s) UNPATCHED`);
  }
  for (const t of state.pluginTargets) {
    const f = plug[t];
    if (f.patched < f.files) drifting.push(`${t}: ${f.files - f.patched}/${f.files} plugin file(s) UNPATCHED`);
  }
  // Stale stable copy = the hook and the monitor are running code the user no longer has
  // installed. It is not a patch drifting; it is the PATCHER drifting, so it is reported
  // separately rather than folded into `drifting`. null = no global install to compare
  // against (npx-only), which is unknown, not clean — callers must not print it as "none".
  const staleLib = stableLibDrift();

  return {
    installed: [...state.patchTargets, ...state.pluginTargets],
    drifting,
    staleLib,
    uncovered: scanUncoveredBuilds(),
  };
}

// ─── scheduling ──────────────────────────────────────────────────────────────

export function plistBody(secs) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${MONITOR_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${MONITOR_SCRIPT}</string>
  </array>
  <key>StartInterval</key><integer>${secs}</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
</dict>
</plist>
`;
}

// Returns { ok, err } — the REASON, not just the verdict. It used to swallow stderr and return
// a bare boolean, so a failed `launchctl load` reached monitorCommand as { ok: false } with no
// `why`; it printed the literal string `[monitor] undefined`, exited 0, and `make install` went
// on to announce "monitor scheduled". The monitor was not scheduled. A watchdog that fails to
// install, and says `undefined` while doing it, is the worst possible version of this bug.
function launchctl(...args) {
  try {
    execFileSync('launchctl', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    return { ok: true, err: '' };
  } catch (e) {
    const err = (e.stderr ? e.stderr.toString() : '').trim() || e.message || 'unknown error';
    return { ok: false, err };
  }
}

function readCrontab() {
  try { return execFileSync('crontab', ['-l'], { encoding: 'utf8' }); } catch { return ''; }
}
function writeCrontab(text) {
  execFileSync('crontab', ['-'], { input: text.endsWith('\n') ? text : `${text}\n` });
}
export function cronWithout(text) {
  return text.split('\n').filter((l) => !l.includes(CRON_TAG)).join('\n').replace(/\n+$/, '');
}

// Write down exactly what we scheduled, so the prompt hook can verify it later with plain
// fs checks — no launchctl, no crontab, nothing that costs a subprocess on the prompt path.
function writeMonitorMeta(secs) {
  try {
    fs.mkdirSync(STABLE_DIR, { recursive: true });
    fs.writeFileSync(MONITOR_META_PATH, `${JSON.stringify({
      node: process.execPath,
      script: MONITOR_SCRIPT,
      intervalSec: secs,
      scheduledAt: new Date().toISOString(),
    }, null, 2)}\n`);
  } catch { /* best-effort */ }
}

export function installMonitor() {
  const secs = interval();
  if (!fs.existsSync(MONITOR_SCRIPT)) {
    return { ok: false, how: 'none', why: `runtime not installed — run a patch target's \`install\` first (missing ${MONITOR_SCRIPT})` };
  }
  writeMonitorMeta(secs);

  if (process.platform === 'darwin') {
    fs.mkdirSync(path.dirname(PLIST), { recursive: true });
    fs.writeFileSync(PLIST, plistBody(secs));
    launchctl('unload', PLIST); // idempotent: drop any previous definition
    const r = launchctl('load', PLIST);
    if (!r.ok) {
      return {
        ok: false,
        how: 'launchd',
        secs,
        where: PLIST,
        why: `launchctl load failed: ${r.err}\n    the monitor is NOT scheduled — the patches will not be re-applied between sessions.\n    retry:  launchctl load ${PLIST}`,
      };
    }
    return { ok: true, how: 'launchd', secs, where: PLIST };
  }

  if (process.platform === 'linux') {
    // cron granularity is 1 minute; anything finer is pointless here.
    const mins = Math.max(1, Math.round(secs / 60));
    const spec = mins === 1 ? '* * * * *' : `*/${mins} * * * *`;
    const line = `${spec} "${process.execPath}" "${MONITOR_SCRIPT}" >/dev/null 2>&1 ${CRON_TAG}`;
    const next = `${cronWithout(readCrontab())}\n${line}`.replace(/^\n/, '');
    try { writeCrontab(next); } catch (e) { return { ok: false, how: 'cron', why: e.message }; }
    return { ok: true, how: 'cron', secs: mins * 60, where: 'crontab' };
  }

  return {
    ok: false,
    how: 'manual',
    why: `unsupported platform (${process.platform}) — schedule this yourself every ${secs}s:\n    ${process.execPath} ${MONITOR_SCRIPT}`,
  };
}

export function uninstallMonitor() {
  // Drop the meta + heartbeat too, or the prompt hook would go on warning that a monitor we
  // deliberately removed "is not running".
  try { fs.rmSync(MONITOR_META_PATH, { force: true }); } catch { /* ignore */ }
  try { fs.rmSync(HEARTBEAT_PATH, { force: true }); } catch { /* ignore */ }

  if (process.platform === 'darwin') {
    const existed = fs.existsSync(PLIST);
    launchctl('unload', PLIST);
    if (existed) fs.rmSync(PLIST, { force: true });
    return { removed: existed, how: 'launchd', where: PLIST };
  }
  if (process.platform === 'linux') {
    const cur = readCrontab();
    if (!cur.includes(CRON_TAG)) return { removed: false, how: 'cron' };
    try { writeCrontab(cronWithout(cur)); } catch { return { removed: false, how: 'cron' }; }
    return { removed: true, how: 'cron' };
  }
  return { removed: false, how: 'manual' };
}

// The scheduled job records an ABSOLUTE node path (process.execPath). Version managers
// pin that per version — e.g. mise: .../installs/node/24.14.1/bin/node — so upgrading node
// deletes the interpreter out from under the job. launchd/cron keep reporting the job as
// "scheduled" while every run fails silently, which is the worst possible failure for a
// watchdog. Surface it instead of trusting the schedule.
export function recordedNode() {
  try {
    if (process.platform === 'darwin') {
      const m = fs.readFileSync(PLIST, 'utf8').match(/<string>([^<]*node)<\/string>/);
      return m ? m[1] : null;
    }
    const m = readCrontab().split('\n').find((l) => l.includes(CRON_TAG))?.match(/"([^"]+)"/);
    return m ? m[1] : null;
  } catch { return null; }
}

// Same failure mode as a vanished node interpreter, one level up: the scheduler records
// an ABSOLUTE path to the job script, so MOVING that script (flat -> lib/cwd/) leaves
// launchd/cron happily invoking a path that no longer exists — or, worse, an OLD copy
// still sitting there, so the monitor keeps "succeeding" while running stale code that
// doesn't know about half the installed targets. Detect it, and heal it on install.
export function recordedScript() {
  try {
    if (process.platform === 'darwin') {
      const m = fs.readFileSync(PLIST, 'utf8').match(/<string>([^<]*\.mjs)<\/string>/);
      return m ? m[1] : null;
    }
    const m = readCrontab().split('\n').find((l) => l.includes(CRON_TAG))?.match(/"([^"]+\.mjs)"/);
    return m ? m[1] : null;
  } catch { return null; }
}

/** If the schedule points at anything other than the current job script, re-register it. */
export function healMonitor() {
  const script = recordedScript();
  if (!script || script === MONITOR_SCRIPT) return { healed: false };
  const r = installMonitor();
  return { healed: !!r.ok, from: script, to: MONITOR_SCRIPT };
}

export function monitorScheduled() {
  const node = recordedNode();
  const nodeOk = node ? fs.existsSync(node) : true;
  const script = recordedScript();
  const stale = node && !nodeOk
    ? `scheduled node interpreter is GONE (${node}) — every run fails silently; re-run \`monitor install\``
    : (script && script !== MONITOR_SCRIPT
      ? `scheduled job points at a STALE script (${script}) — it is not the current one; re-run \`monitor install\``
      : null);

  if (process.platform === 'darwin') {
    if (!fs.existsSync(PLIST)) return { scheduled: false, how: 'launchd' };
    let loaded = false;
    try { loaded = execFileSync('launchctl', ['list'], { encoding: 'utf8' }).includes(MONITOR_LABEL); } catch { /* ignore */ }
    return { scheduled: loaded, how: 'launchd', where: PLIST, node, stale };
  }
  if (process.platform === 'linux') {
    return { scheduled: readCrontab().includes(CRON_TAG), how: 'cron', where: 'crontab', node, stale };
  }
  return { scheduled: false, how: 'manual' };
}

export function lastRun() {
  try {
    const lines = fs.readFileSync(MONITOR_LOG, 'utf8').trim().split('\n').filter(Boolean);
    return lines.length ? lines[lines.length - 1] : null;
  } catch { return null; }
}
