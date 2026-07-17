#!/usr/bin/env node
// The scheduled job body (launchd / cron invoke THIS).
//
// Short-lived on purpose: re-apply the installed target set, log only if it actually
// had to repair something, exit. Steady state is a few stats and no writes.

import { runOnce, appendLog } from './monitor.mjs';
import { recordProblems, addProblems } from './problems.mjs';
import { recoverStaleWriters } from './stale-writer.mjs';

try {
  runOnce();

  // AUTO-RESTART STALE MEMORY WRITERS (ADR-023). A ruflo MCP client / daemon still running
  // pre-patch memory code can flush a stale image back over a healthy .swarm/memory.db —
  // the exact tear that hit semantic-product-mock, and one the in-file lock cannot stop
  // because the stale process never loaded it. SIGTERM it so it reloads patched. Guarded:
  // recoverStaleWriters only ever kills a process it positively identified as running
  // unpatched/pre-patch code, and RSP_NO_STALE_WRITER_KILL turns the kill off (still detects
  // + logs). Best-effort and quiet in the steady state, like the rest of the tick.
  //
  // Killing an MCP client is NOT invisible like a daemon respawn: per user directive, it is
  // killed anyway, but Claude Code will not reconnect it on its own (validated live — see
  // stale-writer.mjs). So every such kill ALSO gets pushed into the shared problem feed via
  // addProblems (merges rather than clobbering whatever runOnce just recorded above), which the
  // UserPromptSubmit notifier surfaces on the user's very next prompt in ANY session — the
  // monitor cannot reach the specific session it just killed, so this is the loudest channel
  // this package has.
  try {
    const rec = recoverStaleWriters();
    for (const line of rec.log) appendLog(line);
    const mcpKills = rec.killed.filter((w) => w.kind !== 'daemon');
    if (mcpKills.length) {
      addProblems([
        `!! ruflo-source-patch KILLED ${mcpKills.length} stale MCP client(s) to force fresh code: pid ${mcpKills.map((w) => w.pid).join(', ')}`,
        '!! ruflo MCP access in EACH of those sessions is now dead and will NOT come back on its own.',
        '!! ACTION REQUIRED in each affected session: run `/mcp` and select Reconnect (or `/reload-plugins`).',
      ]);
    }
  } catch (e) { try { appendLog(`WARN stale-writer recovery failed: ${e && e.message ? e.message : e}`); } catch { /* log is best-effort */ } }

  // SELF-UPDATE, at the END of the tick and never before it.
  //
  // This is the ONLY thing that carries a new supersession predicate (or a fix to the patcher itself) to
  // a machine, and it has to be here rather than on the SessionStart hook: sessions run for days, and a
  // patch that upstream's restructuring has turned from redundant into actively WRONG would keep being
  // re-applied every 5 minutes until someone restarted Claude Code.
  //
  // Immutable TAGS only, forward only. The child rewrites ~/.ruflo-source-patch/lib while this process
  // already holds its modules in memory, so the new code takes effect on the NEXT tick, not this one.
  const { selfUpdate } = await import('./update-check.mjs');
  const u = await selfUpdate();
  if (u.updated) {
    appendLog(`SELF-UPDATE ${u.from} -> ${u.to} (immutable tag) — effective next tick`);
    recordProblems([]);   // whatever the old code was complaining about, the new code re-decides
  } else if (u.error) {
    appendLog(`WARN self-update to ${u.to} failed (${u.error}) — staying on ${u.from}`);
  }
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
