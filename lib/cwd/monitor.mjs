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
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { apply, inspect, scanUncoveredBuilds } from './patch-library.mjs';
import { readState, migrateLegacyState } from './state.mjs';
import { STABLE_DIR, STABLE_LIB } from './paths.mjs';

export const MONITOR_LABEL = 'com.sparkleideas.ruflo-source-patch.monitor';
export const MONITOR_LOG = path.join(STABLE_DIR, 'monitor.log');
const MONITOR_SCRIPT = path.join(STABLE_LIB, 'monitor-run.mjs');
const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${MONITOR_LABEL}.plist`);
const CRON_TAG = '# ruflo-source-patch monitor';

const DEFAULT_INTERVAL = 300; // seconds
const interval = () => {
  const n = parseInt(process.env.RSP_MONITOR_INTERVAL || '', 10);
  return Number.isFinite(n) && n >= 30 ? n : DEFAULT_INTERVAL;
};

// ─── the job body ────────────────────────────────────────────────────────────

function appendLog(line) {
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
  // Same legacy migration the SessionStart hook does. A pre-2.0 install has patched files
  // but no state.json; reading state raw would make the monitor a silent no-op on exactly
  // the machines that most need it.
  const anyPatched = Object.values(inspect()).some((x) => x.patched > 0);
  const state = migrateLegacyState(anyPatched);
  if (state.paused) return { skipped: true, paused: true, repaired: 0 };
  if (!state.patchTargets.length) return { skipped: true, repaired: 0 };

  const r = apply(state.patchTargets);
  if (r.patched > 0) {
    // Something overwrote a patched file (npx fetched a new copy, or ruflo updated).
    appendLog(`REPAIRED ${r.patched} file(s) [${state.patchTargets.join(',')}] — ${r.log.filter((l) => l.startsWith('patched')).join(' | ')}`);
  }
  for (const w of scanUncoveredBuilds()) appendLog(`WARN ${w}`);
  return { skipped: false, repaired: r.patched, unchanged: r.unchanged, result: r };
}

// ─── drift check (no writes) ─────────────────────────────────────────────────

export function checkDrift() {
  const state = readState();
  const found = inspect();
  const drifting = [];
  // A paused (reverted) library is unpatched ON PURPOSE — that is not drift, and gating CI
  // on it would be wrong.
  if (state.paused) return { installed: state.patchTargets, drifting: [], paused: true, uncovered: scanUncoveredBuilds() };
  for (const t of state.patchTargets) {
    const f = found[t];
    if (f.patched < f.files) drifting.push(`${t}: ${f.files - f.patched}/${f.files} file(s) UNPATCHED`);
  }
  return { installed: state.patchTargets, drifting, uncovered: scanUncoveredBuilds() };
}

// ─── scheduling ──────────────────────────────────────────────────────────────

function plistBody(secs) {
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

function launchctl(...args) {
  try { execFileSync('launchctl', args, { stdio: 'ignore' }); return true; } catch { return false; }
}

function readCrontab() {
  try { return execFileSync('crontab', ['-l'], { encoding: 'utf8' }); } catch { return ''; }
}
function writeCrontab(text) {
  execFileSync('crontab', ['-'], { input: text.endsWith('\n') ? text : `${text}\n` });
}
function cronWithout(text) {
  return text.split('\n').filter((l) => !l.includes(CRON_TAG)).join('\n').replace(/\n+$/, '');
}

export function installMonitor() {
  const secs = interval();
  if (!fs.existsSync(MONITOR_SCRIPT)) {
    return { ok: false, how: 'none', why: `runtime not installed — run a patch target's \`install\` first (missing ${MONITOR_SCRIPT})` };
  }

  if (process.platform === 'darwin') {
    fs.mkdirSync(path.dirname(PLIST), { recursive: true });
    fs.writeFileSync(PLIST, plistBody(secs));
    launchctl('unload', PLIST); // idempotent: drop any previous definition
    const ok = launchctl('load', PLIST);
    return { ok, how: 'launchd', secs, where: PLIST };
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
function recordedNode() {
  try {
    if (process.platform === 'darwin') {
      const m = fs.readFileSync(PLIST, 'utf8').match(/<string>([^<]*node)<\/string>/);
      return m ? m[1] : null;
    }
    const m = readCrontab().split('\n').find((l) => l.includes(CRON_TAG))?.match(/"([^"]+)"/);
    return m ? m[1] : null;
  } catch { return null; }
}

export function monitorScheduled() {
  const node = recordedNode();
  const nodeOk = node ? fs.existsSync(node) : true;
  const stale = node && !nodeOk
    ? `scheduled node interpreter is GONE (${node}) — every run fails silently; re-run \`monitor install\``
    : null;

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
