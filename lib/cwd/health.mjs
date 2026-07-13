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
import { HEARTBEAT_PATH, MONITOR_META_PATH } from './paths.mjs';

// Generous on purpose. A laptop that slept through six ticks is not a broken monitor, and a
// false alarm here trains you to ignore a true one. launchd's RunAtLoad refreshes the
// heartbeat promptly on wake, so a real outage still surfaces within minutes.
const STALE_FACTOR = 6;
const STALE_FLOOR_MS = 30 * 60 * 1000;

/** Problems with the monitor ITSELF. Empty when it is alive, or deliberately not installed. */
export function monitorHealthProblems(now = Date.now()) {
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
  const staleAfter = Math.max(intervalMs * STALE_FACTOR, STALE_FLOOR_MS);
  let beat = 0;
  try { beat = fs.statSync(HEARTBEAT_PATH).mtimeMs; } catch { /* never ticked */ }

  if (!beat) {
    problems.push('monitor: scheduled, but has NEVER run — the patches are not being kept alive. Check: `monitor status`');
  } else if (now - beat > staleAfter) {
    const mins = Math.round((now - beat) / 60000);
    problems.push(`monitor: scheduled, but has not run for ${mins} min (expected every ${Math.round(intervalMs / 60000)} min) — nothing is watching the patches. Check: \`monitor status\``);
  }

  return problems;
}

/** Called on every monitor tick — this is the proof of life the check above looks for. */
export function beat() {
  try { fs.writeFileSync(HEARTBEAT_PATH, `${new Date().toISOString()}\n`); } catch { /* best-effort */ }
}
