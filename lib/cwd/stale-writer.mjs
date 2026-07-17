// Target: memory — the STALE-WRITER guard (ADR-023).
//
// The write lock and the integrity gate (patch-library's memLock + integrityGate frags)
// live INSIDE the patched memory-initializer.js. They protect the store only for a process
// that is actually RUNNING that patched code. A long-running ruflo writer — the plugin MCP
// server, a project daemon — that loaded memory-initializer.js BEFORE the memory patch was
// applied, or that runs a DIFFERENT npx cache copy the patch never touched, keeps writing
// the old, unguarded, pre-atomic way from memory until it is restarted. That process is
// exactly what tore semantic-product-mock/.swarm/memory.db: a stale image flushed back over
// a healthy file. No source patch can reach into a process that never loaded it — the only
// fix is to make the stale writer stop and reload.
//
// So this module does two things, split the way the rest of the package splits detection
// from action (the hook REPORTS, the monitor/cleanup ACTS — see session-start.mjs's leak
// detector):
//
//   staleWriters()          — pure detection. Which running ruflo workers are provably on
//                             pre-patch / unpatched memory code. The SessionStart hook calls
//                             this and WARNS.
//   recoverStaleWriters()   — the monitor tick calls this and, unless opted out, SIGTERMs
//                             each stale writer so it respawns (daemon) or reloads on the next
//                             session (MCP server) with the patched code.
//
// HARD SAFETY, same bar as cleanup.mjs: a process is only ever named — or killed — when we
// can POSITIVELY identify it as a ruflo memory writer (its argv resolves to an
// @claude-flow/cli install) AND prove it is running unpatched/pre-patch memory code. Anything
// we cannot resolve is left strictly alone. And the whole detector is inert unless the
// `memory` target is installed: with no write lock to protect, an unpatched copy is not a
// fault, it is just the unpatched state the user chose.

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { readState } from './state.mjs';
import { pidAgeSeconds } from './cleanup.mjs';

// The kill switch, mirrored on RSP_NO_MONITOR_RECOVER (ADR-021). Set it and the monitor still
// DETECTS and reports, but never kills — for a user who would rather restart writers by hand.
export const KILL_DISABLED = () => !!process.env.RSP_NO_STALE_WRITER_KILL;

// A patched copy carries the write-lock guard. This is the SAME signal entryApplied() trusts
// (the injected replacement text), not the shared MARKER — memory-initializer.js is patched by
// `cwd` too, so a MARKER-only check would call a cwd-only copy "patched" while the lock is absent.
const PATCHED_NEEDLE = '__rufloGuard(storeEntry';

// Pull the @claude-flow/cli install root out of a worker's argv. Two shapes reach us, and the
// SECOND is the one that actually matters: the plugin MCP server is launched by
// `npm exec @claude-flow/cli@latest`, whose worker runs `node .../node_modules/.bin/cli` — a
// SYMLINK, with no `@claude-flow/cli` in the argv at all. Matching only the direct
// `.../node_modules/@claude-flow/cli/bin/cli.js` form (the daemon's shape) silently skips every
// plugin MCP server, which was a real blind spot: on a live box it reported zero stale writers
// while five pre-patch MCP servers were running. So resolve the symlink too. The `npm exec`
// wrapper itself is still NOT matched — killing a wrapper kills the wrong thing.
function cliRootOf(cmd) {
  let m = /(\/[^\s]*\/node_modules\/@claude-flow\/cli)\b/.exec(cmd);
  if (m) return m[1];
  m = /(\/[^\s]*\/node_modules)\/\.bin\/cli\b/.exec(cmd);
  if (m) {
    try {
      const real = fs.realpathSync(`${m[1]}/.bin/cli`);          // -> .../@claude-flow/cli/bin/cli.js
      const r = /(.*\/node_modules\/@claude-flow\/cli)\b/.exec(real);
      if (r) return r[1];
    } catch { /* dangling symlink — cannot resolve, so cannot assess */ }
  }
  return null;
}

// The role of a resolved ruflo worker, from the subcommand AFTER its entrypoint. The persistent
// WRITERS worth guarding are the mcp server, the project daemon, and the plugin's default stdio
// server (`npm exec @claude-flow/cli` with NO subcommand — that is the plugin MCP server). A
// one-shot with any other subcommand (`memory store`, `hooks …`) exits in well under a monitor
// tick and is NOT a persistent writer, so it returns null and is left strictly alone.
function roleOf(cmd) {
  const after = cmd.replace(/^.*?(?:\/\.bin\/cli|\/@claude-flow\/cli\/bin\/cli\.js|\/cli\.js)\b/, '');
  const first = (after.split(/\s+/).filter((a) => a && !a.startsWith('-'))[0]) || '';
  if (first === 'mcp') return 'mcp';
  if (first === 'daemon') return 'daemon';
  if (first === '') return 'server';   // no subcommand = the plugin's default stdio MCP server
  return null;                          // a one-shot subcommand — not a persistent writer
}

// Every running process as { pid, ageSec, cmd }. `ps -Awwo` — the double-w defeats the
// command-line truncation that would hide the subcommand and the cli path we match on.
function processes() {
  let out;
  try { out = execFileSync('ps', ['-Awwo', 'pid=,command='], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }); }
  catch { return []; }
  const rows = [];
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    rows.push({ pid: Number(m[1]), cmd: m[2] });
  }
  return rows;
}

/**
 * Running ruflo workers that are writing memory.db with unsafe code. Pure — reads the process
 * list + files, changes nothing. Returns [] when the `memory` target is not installed (nothing
 * to protect) or nothing is stale.
 *
 * Each result: { pid, kind: 'mcp'|'daemon'|'server', cliRoot, severity, reason }.
 *
 * severity records whether the copy on disk is patched; recovery combines it with `kind` to decide
 * whether an automatic restart would actually FIX the process without collateral damage:
 *   'pre-patch' — the copy on disk IS patched; the process just started before that patch and runs
 *                 the older module from memory. A restart loads the patched copy. Safe to auto-restart
 *                 ONLY for a daemon (it respawns on next use); an MCP client is not auto-restartable
 *                 (killing it does not bring it back — see recoverStaleWriters).
 *   'unpatched' — the copy on disk carries NO write lock, because the patch could not be applied to
 *                 it (anchor drift, permissions). A restart would respawn from the same unpatched
 *                 copy and LOOP, so it is never auto-killed. The fix is re-anchoring the patch, which
 *                 runOnce attempts and the drift machinery reports when it cannot.
 */
export function staleWriters({ now = Date.now() } = {}) {
  if (!readState().patchTargets.includes('memory')) return [];

  const self = process.pid;
  const out = [];
  for (const { pid, cmd } of processes()) {
    if (pid === self) continue;
    const kind = roleOf(cmd);
    if (!kind) continue;
    const cliRoot = cliRootOf(cmd);
    if (!cliRoot) continue; // an npm-exec wrapper or an unresolvable path — never touch it

    const mi = `${cliRoot}/dist/src/memory/memory-initializer.js`;
    let src, mtimeMs;
    try { const st = fs.statSync(mi); mtimeMs = st.mtimeMs; src = fs.readFileSync(mi, 'utf8'); }
    catch { continue; } // no memory module at that root — not a memory writer we can assess

    if (!src.includes(PATCHED_NEEDLE)) {
      out.push({ pid, kind, cliRoot, severity: 'unpatched', reason: 'running an @claude-flow/cli copy with NO write lock (the memory patch never reached this copy)' });
      continue;
    }
    // The copy on disk IS patched. But a process that started BEFORE that patch landed is still
    // running the pre-patch module it loaded into memory. Compare elapsed process time against
    // how long ago the module was patched; a margin absorbs stat/clock jitter.
    const ageSec = pidAgeSeconds(pid);
    const patchedAgoSec = (now - mtimeMs) / 1000;
    if (ageSec > 0 && patchedAgoSec > 0 && ageSec > patchedAgoSec + 5) {
      out.push({ pid, kind, cliRoot, severity: 'pre-patch', reason: `started ${Math.round(ageSec)}s ago, before its memory patch (rewritten ${Math.round(patchedAgoSec)}s ago) — running the older module from memory` });
    }
  }
  return out;
}

// A restart is worth doing whenever the ON-DISK copy is already patched and the process merely
// predates it — 'pre-patch', any kind (daemon OR MCP client). A daemon respawns on next use, no
// human involved. An MCP client does NOT: VALIDATED LIVE (2026-07-17, this package's own session
// killed its own MCP client and retried a tool call with no other action — instant failure, no
// on-demand respawn, matching Claude Code's docs, "stdio servers... are not reconnected
// automatically", https://code.claude.com/docs/en/mcp.md). Reloading one needs a SECOND, human step
// after the kill, inside that exact session: `/mcp` -> Reconnect, or `/reload-plugins` for a plugin
// server (Reconnect on a still-ALIVE stale process is a no-op — confirmed live — so the kill has to
// happen first). The user has weighed that cost and chosen to auto-kill anyway, on the condition
// that the warning is impossible to miss (see describeStaleWriters + monitor-run.mjs's problem feed).
//
// 'unpatched' writers (any kind) are still NEVER auto-killed: the copy on disk has no lock because
// the patch could not be applied, so ANY respawn — daemon or, after a manual reconnect, MCP client —
// reads the same unpatched copy and gains nothing. That is patch drift, fixed by re-anchoring, which
// the drift machinery already surfaces; killing the process here would only add a needless outage.
const isAutoRestartable = (w) => w.severity === 'pre-patch';

/** Human-facing lines for the SessionStart hook — warns about every stale writer. */
export function describeStaleWriters(writers) {
  if (!writers.length) return [];
  const restartableDaemons = writers.filter((w) => isAutoRestartable(w) && w.kind === 'daemon');
  const restartableMcp = writers.filter((w) => isAutoRestartable(w) && w.kind !== 'daemon');
  const unpatched = writers.filter((w) => w.severity === 'unpatched');
  const lines = [`[ruflo-source-patch] ${writers.length} stale memory writer(s) running old code against .swarm/memory.db:`];
  for (const w of writers.slice(0, 8)) lines.push(`  pid=${w.pid} (${w.kind}) ${w.severity} — ${w.reason}`);
  if (restartableDaemons.length) lines.push('  pre-patch daemons: the monitor restarts these (they respawn patched) unless RSP_NO_STALE_WRITER_KILL is set; now: monitor run');
  if (restartableMcp.length) {
    lines.push(`  !! pre-patch MCP client(s) WILL BE KILLED by the monitor to force fresh code: ${restartableMcp.map((w) => w.pid).join(', ')}`);
    lines.push('  !! ruflo MCP access in EACH of those sessions dies and does NOT come back on its own.');
    lines.push('  !! ACTION REQUIRED in each affected session: run `/mcp` -> Reconnect (or `/reload-plugins`).');
  }
  if (unpatched.length) lines.push('  unpatched writer(s): the patch could not be applied to that copy (drift) — a respawn would just reload unpatched. Check: monitor check');
  return lines;
}

/**
 * The monitor's action: restart every writer a restart actually FIXES — pre-patch writers, daemon
 * OR MCP client (see isAutoRestartable). A daemon respawn is invisible; an MCP-client kill is NOT —
 * per user directive, kill it anyway and warn LOUDLY, because Claude Code will not reconnect a
 * killed stdio server on its own (see the fragment comment above). Every killed MCP client's log
 * line is written to double as a monitor-log entry AND a machine-wide "problem" (via the caller
 * feeding `killedMcpWarnings` into recordProblems — see monitor-run.mjs), so it reaches the user's
 * very next prompt in ANY session, not just a session that happens to restart. Unpatched writers are
 * still never auto-killed (a respawn gains nothing — same broken copy either way).
 * Guarded — only ever signals a process staleWriters() positively identified. `dryRun` reports
 * without killing; KILL_DISABLED() reports without killing. Returns { detected, killed, log }.
 */
export function recoverStaleWriters({ dryRun = false } = {}) {
  const writers = staleWriters();
  const log = [];
  if (!writers.length) return { detected: [], killed: [], log };

  const killed = [];
  const suppressed = dryRun || KILL_DISABLED();
  for (const w of writers) {
    if (!isAutoRestartable(w)) {
      log.push(`NOT killed pid=${w.pid} (${w.kind}, ${w.severity}) — unpatched copy, a respawn would loop unpatched; re-anchor the patch (drift) — ${w.reason}`);
      continue;
    }
    const isMcp = w.kind !== 'daemon';
    const how = isMcp
      ? 'ruflo MCP access in that session is now DEAD — run /mcp -> Reconnect (or /reload-plugins) THERE to restore it, it will NOT come back on its own'
      : 'respawns patched on next use';
    if (suppressed) { log.push(`${dryRun ? 'would kill' : `${w.severity} (kill disabled)`} pid=${w.pid} (${w.kind}) — ${how} — ${w.reason}`); continue; }
    try {
      process.kill(w.pid, 'SIGTERM');
      killed.push(w);
      log.push(`${isMcp ? '!! KILLED MCP CLIENT' : 'restarted pre-patch daemon'} pid=${w.pid} — ${how} — ${w.reason}`);
    } catch (e) { log.push(`could not kill pid=${w.pid}: ${e.message}`); }
  }
  return { detected: writers, killed, log };
}
