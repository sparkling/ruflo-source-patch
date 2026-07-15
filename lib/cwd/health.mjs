// Is the monitor actually alive?
//
// Everything else in this project reports through the monitor. So if the monitor is dead,
// the system goes quiet — and quiet is exactly what "healthy" looks like. That is the one
// failure a watchdog can never report on itself, so someone else has to ask.
//
// The prompt hook asks, on every prompt, which means these checks must be nearly free:
// existsSync + one mtime, no subprocess, no launchctl, no crontab. That is what monitor.json
// buys us — the monitor writes down what it scheduled, and we verify the world still matches.
//
// Three ways a scheduled monitor is silently not running:
//
//   1. its node interpreter is GONE — version managers pin an absolute path
//      (mise: .../installs/node/24.14.1/bin/node), so a node upgrade deletes the interpreter
//      out from under the job. launchd/cron keep reporting it as scheduled while every run
//      fails instantly.
//   2. its script path is STALE — the job points at a file we have since moved.
//   3. it just is not running — scheduled, interpreter fine, but no tick in a long time
//      (unloaded launchd job, removed crontab line, permissions, a crash loop).
//
// Only (3) needs a heartbeat; (1) and (2) are pure path checks. All three are invisible
// without this.

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { HEARTBEAT_PATH, MONITOR_META_PATH } from './paths.mjs';

// The heartbeat is a cheap GATE, not the verdict. A healthy monitor writes it at the start of every
// tick, so its age is a sawtooth 0..interval; the prompt hook only runs while you are ACTIVE (so ticks
// are firing ~on time), which means a healthy heartbeat is at most ~1 interval old in the moment we look.
// TWO missed ticks is therefore a real signal, and one interval of margin keeps normal timer jitter from
// tripping the gate. No 30-minute floor: the old floor existed only because the heartbeat alone could not
// tell a DROPPED job from an idle/slept one — the authoritative probe below now does. See ADR-021.
const STALE_INTERVALS = 2;

// Authoritative "is the scheduled job actually loaded?" — the ONE subprocess, and it runs ONLY when the
// heartbeat is already stale (rare), never on a healthy prompt. It is what distinguishes a DROPPED agent
// (recover) from a machine that merely idled or slept (no tick was expected; nothing is wrong). On ANY
// uncertainty it returns true: we never declare the monitor down — and trigger a recovery — on a probe we
// could not run.
function defaultProbeLoaded(meta) {
  try {
    if (process.platform === 'darwin') {
      if (!meta.label) return true; // pre-label meta (an install from before ADR-021) — assume alive
      if (execFileSync('launchctl', ['list'], { encoding: 'utf8' }).includes(meta.label)) return true;
      try { execFileSync('launchctl', ['print', `gui/${process.getuid()}/${meta.label}`], { stdio: 'ignore' }); return true; }
      catch { return false; }
    }
    if (process.platform === 'linux') {
      return execFileSync('crontab', ['-l'], { encoding: 'utf8' }).includes(meta.script);
    }
    return true;
  } catch { return true; }
}

/**
 * Problems with the monitor ITSELF. Empty when it is alive, or deliberately not installed.
 * `probeLoaded` is injectable so the "loaded but idle" vs "genuinely dropped" branches can be tested
 * without a real launchd job (which is machine-global, not sandboxable).
 */
export function monitorHealthProblems(now = Date.now(), probeLoaded = defaultProbeLoaded) {
  let meta;
  try { meta = JSON.parse(fs.readFileSync(MONITOR_META_PATH, 'utf8')); } catch { return []; }
  if (!meta?.script) return [];

  const problems = [];

  if (meta.node && !fs.existsSync(meta.node)) {
    problems.push(`monitor: its node interpreter is GONE (${meta.node}) — every scheduled run fails silently. Fix: \`monitor install\``);
  }
  if (!fs.existsSync(meta.script)) {
    problems.push(`monitor: its job script is missing (${meta.script}) — nothing is running. Fix: \`monitor install\``);
  }

  const intervalMs = (meta.intervalSec || 300) * 1000;
  const staleAfter = intervalMs * STALE_INTERVALS;
  let beat = 0;
  try { beat = fs.statSync(HEARTBEAT_PATH).mtimeMs; } catch { /* never ticked */ }

  // Stale heartbeat is AMBIGUOUS (dropped OR idle/slept). Ask the scheduler directly, once. Only a job
  // that is genuinely NOT loaded is "down"; a loaded-but-stale job just idled — say nothing, and never
  // auto-kick it (that would be the sleep false-positive returning in a new form).
  const stale = !beat || now - beat > staleAfter;
  if (stale && !probeLoaded(meta)) {
    const mins = beat ? Math.round((now - beat) / 60000) : null;
    problems.push(`monitor: its scheduled job is NOT loaded${mins !== null ? ` (no tick in ${mins} min)` : ' and has never ticked'} — nothing is watching the patches. Fix: \`monitor install\``);
  }

  return problems;
}

/** Called on every monitor tick — this is the proof of life the check above looks for. */
export function beat() {
  try { fs.writeFileSync(HEARTBEAT_PATH, `${new Date().toISOString()}\n`); } catch { /* best-effort */ }
}
