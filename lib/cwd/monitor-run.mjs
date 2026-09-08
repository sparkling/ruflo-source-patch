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
  // because the stale process never loaded it. SIGTERM only a stale daemon so it reloads patched.
  // MCP clients are detected but never killed: this detached process cannot reconnect their host
  // stdio transport. RSP_NO_STALE_WRITER_KILL turns daemon recovery off too (detection remains).
  //
  // A deferred stale MCP is pushed into the shared problem feed so the user can perform the
  // controlled reconnect inside the exact owning session without losing the transport first.
  try {
    const rec = recoverStaleWriters();
    for (const line of rec.log) appendLog(line);
    const deferredMcp = rec.detected.filter((w) => w.kind !== 'daemon' && w.severity === 'pre-patch');
    if (deferredMcp.length) {
      addProblems([
        `ruflo-source-patch deferred ${deferredMcp.length} stale MCP client(s): pid ${deferredMcp.map((w) => w.pid).join(', ')}`,
        'The monitor did NOT kill them because it cannot reconnect their host stdio transport.',
        'Reconnect Ruflo in each affected host session before relying on newly patched memory bytes.',
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
