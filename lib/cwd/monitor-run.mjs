#!/usr/bin/env node
// The scheduled job body (launchd / cron invoke THIS).
//
// Short-lived on purpose: re-apply the installed target set, log only if it actually
// had to repair something, exit. Steady state is a few stats and no writes.

import { runOnce, appendLog } from './monitor.mjs';
import { recordProblems } from './problems.mjs';

try {
  runOnce();
} catch (err) {
  // A tick must never fail LOUDLY — launchd would just keep restarting it. But it must never
  // fail SILENTLY either, and this catch was empty: whatever killed the tick vanished without
  // a trace, while beat() (which runs first, by design) left a fresh heartbeat behind. The
  // health check then reported a perfectly live monitor. A watchdog that dies every tick and
  // certifies its own health is worse than no watchdog — it is the exact failure mode this
  // package was written to hunt.
  //
  // So: swallow it, but write it down where a human will actually see it — monitor.log AND
  // the prompt notifier.
  try { appendLog(`ERROR monitor tick failed: ${err && err.stack ? err.stack.split('\n')[0] : err}`); } catch { /* log is best-effort */ }
  try { recordProblems([`monitor tick failed: ${err && err.message ? err.message : err}`]); } catch { /* so is the note */ }
}

process.exit(0);
