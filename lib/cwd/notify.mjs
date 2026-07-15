#!/usr/bin/env node
// UserPromptSubmit hook body — the timely half of the warning, AND the recovery path for a monitor
// that has fallen over (ADR-021).
//
// The SessionStart hook only speaks when a session STARTS. A ruflo version can land in the npx cache
// mid-session (3.26.1 did exactly that, and silently disabled the cwd/daemon-autostart patch), so a
// break could sit unannounced for hours. This runs on every prompt.
//
// It used to ONLY report, on the principle that "repair is the monitor's job." But that principle breaks
// for the ONE failure that matters most: a monitor that is DOWN cannot repair itself — a dead tick never
// runs. So a dropped launchd agent (logout, sleep, a launchd quirk, a vanished version-manager node) has
// no way back until someone restarts Claude Code. This live hook IS that way back: when — and ONLY when —
// the cheap liveness check says the monitor is not running, it re-bootstraps it, records why, and surfaces
// any crash launchd captured. On a healthy prompt it still does almost nothing: read one small file, and
// return. No subprocess, no launchctl, no heavy import unless the monitor is actually down.

import { takeProblemsToAnnounce, takeLiveToAnnounce, rebaselineGuidance } from './problems.mjs';
import { monitorHealthProblems } from './health.mjs';

try { process.stdin.resume(); process.stdin.on('data', () => {}); } catch { /* ignore */ }

try {
  // The monitor's own liveness — worked out here from a heartbeat and two path checks, because a dead
  // monitor cannot leave a note about being dead. Cheap; empty when the monitor is alive.
  const down = monitorHealthProblems();

  let live = down;
  // RSP_NO_MONITOR_RECOVER=1 keeps this a pure REPORTER (no launchd, no heavy import). The test suite
  // sets it so driving this hook never creates a real, machine-global launchd job from a sandbox plist —
  // recovery touches launchctl, which is not sandboxed by HOME. Real usage leaves it unset and recovers.
  if (down.length && process.env.RSP_NO_MONITOR_RECOVER !== '1') {
    // DOWN. This is the only place that can bring it back. Import the heavy module and touch launchd
    // ONLY now (never on a healthy prompt), attempt an unconditional re-bootstrap, and record it.
    try {
      const { recoverMonitor, readMonitorStderr, clearMonitorStderr, appendLog } = await import('./monitor.mjs');
      const captured = readMonitorStderr();            // a crash launchd caught for a job that died pre-log
      const r = recoverMonitor();
      const crash = captured ? ` — launchd captured: ${captured.split('\n').slice(-3).join(' ⏎ ')}` : '';
      if (r.recovered) {
        appendLog(`RECOVERED monitor was down [${down.join(' | ')}]; re-bootstrapped from the prompt hook${crash}`);
        clearMonitorStderr();
        live = [`monitor was down and has been re-bootstrapped automatically${captured ? ' (a captured crash is in monitor.log)' : ''}. If this recurs, run \`monitor status\`.`];
      } else if (r.attempted) {
        appendLog(`RECOVER-FAILED monitor down [${down.join(' | ')}]; re-bootstrap failed: ${r.why || 'unknown'}${crash}`);
        live = [...down, `auto-recovery FAILED: ${r.why || 'unknown'} — run \`monitor install\``];
      }
      // r.attempted === false means "not installed" — nothing to recover; keep the (probably empty) `down`.
    } catch (e) {
      // Never let recovery block a prompt. Fall back to just warning.
      try { const { appendLog } = await import('./monitor.mjs'); appendLog(`RECOVER-ERROR prompt-hook recovery threw: ${e && e.message ? e.message : e}`); } catch { /* best-effort */ }
      live = down;
    }
  }

  const problems = [
    // What the monitor found and wrote down.
    ...takeProblemsToAnnounce(),
    // ...and the monitor's own liveness / the recovery outcome.
    ...takeLiveToAnnounce('monitor', live),
  ];

  if (problems.length) {
    const lines = [
      '[ruflo-source-patch] ATTENTION — a patch may no longer be doing anything:',
      ...problems.slice(0, 6).map((p) => `  ${p}`),
    ];
    if (problems.length > 6) lines.push(`  … and ${problems.length - 6} more`);
    lines.push('  Check: npx github:sparkling/ruflo-source-patch monitor check');
    lines.push(...rebaselineGuidance(problems));
    console.log(lines.join('\n'));
  }
} catch { /* best-effort: never block a prompt */ }

process.exit(0);
