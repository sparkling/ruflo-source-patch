// Target: memory — the STALE-WRITER guard (ADR-023).
//
// The write lock and image gates (patch-library's memLock in memory-initializer.js plus the
// walRefusal/integrityGate fragments in fs-secure.js) protect only a process that is actually
// RUNNING those patched bytes. A long-running ruflo writer — the plugin MCP
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
//   recoverStaleWriters()   — the monitor tick calls this and, unless opted out, SIGTERMs only
//                             stale daemons, which can respawn patched. MCP clients are reported
//                             but never killed: the host cannot reconnect their stdio transport.
//
// HARD SAFETY, same bar as cleanup.mjs: a process is only ever named — or killed — when we
// can POSITIVELY identify it as a ruflo memory writer (its argv resolves to an
// @claude-flow/cli install) AND prove it is running unpatched/pre-patch memory code. Anything
// we cannot resolve is left strictly alone. And the whole detector is inert unless the
// `memory` target is installed: with no write lock to protect, an unpatched copy is not a
// fault, it is just the unpatched state the user chose.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readState } from './state.mjs';
import { pidAgeSeconds } from './cleanup.mjs';

// The kill switch, mirrored on RSP_NO_MONITOR_RECOVER (ADR-021). Set it and the monitor still
// DETECTS and reports, but never kills — for a user who would rather restart writers by hand.
export const KILL_DISABLED = () => !!process.env.RSP_NO_STALE_WRITER_KILL;

// A current patched copy carries BOTH the fail-closed error contract and the async-context lock.
// The old patch had `__rufloGuard(storeEntry, true)` but returned null on lock failure and then ran
// the mutation unlocked, so accepting the wrapper alone would misclassify unsafe legacy bytes as
// current. Do not use the shared MARKER either: cwd also patches this file without adding a lock.
const PATCHED_NEEDLES = [
  "e.code = 'RSP_MEMORY_LOCK_UNAVAILABLE';",
  'const __rufloLockScope = new __rufloAsyncLocalStorage();',
  'storeEntry = __rufloGuard(storeEntry);',
];

function packageIs(root, name) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name === name; }
  catch { return false; }
}

// Mirror ruflo/bin/ruflo.js's bounded dependency walk. The thin public wrapper can import a
// hoisted sibling @claude-flow/cli rather than a nested dependency. Validate both package names
// before treating that result as killable; an arbitrary executable named `ruflo` is never enough.
function cliRootFromRuflo(wrapperRoot) {
  if (!packageIs(wrapperRoot, 'ruflo')) return null;
  let dir = wrapperRoot;
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, 'node_modules', '@claude-flow', 'cli');
    if (packageIs(candidate, '@claude-flow/cli')) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// Pull the @claude-flow/cli install root out of a worker's argv. Persistent writers reach us as
// the direct CLI, `node_modules/.bin/cli`, or the public `node_modules/.bin/ruflo` thin wrapper.
// The two symlink forms contain no @claude-flow/cli path in argv, so resolve them positively. The
// `npm exec` parent is still NOT matched — killing that wrapper would kill the wrong process.
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
  m = /(\/[^\s]*\/node_modules)\/\.bin\/ruflo\b/.exec(cmd);
  if (m) {
    try {
      const real = fs.realpathSync(`${m[1]}/.bin/ruflo`);        // -> .../ruflo/bin/ruflo.js
      const r = /(.*\/node_modules\/ruflo)\/bin\/ruflo\.js$/.exec(real);
      if (r) return cliRootFromRuflo(r[1]);
    } catch { /* dangling symlink — cannot resolve, so cannot assess */ }
  }
  m = /(\/[^\s]*\/node_modules\/ruflo)\/bin\/ruflo\.js\b/.exec(cmd);
  if (m) return cliRootFromRuflo(m[1]);
  return null;
}

// The role of a resolved ruflo worker, from the subcommand AFTER its entrypoint. The persistent
// WRITERS worth guarding are the mcp server, the project daemon, and the plugin's default stdio
// server (`npm exec @claude-flow/cli` with NO subcommand — that is the plugin MCP server). A
// one-shot with any other subcommand (`memory store`, `hooks …`) exits in well under a monitor
// tick and is NOT a persistent writer, so it returns null and is left strictly alone.
function roleOf(cmd) {
  const after = cmd.replace(/^.*?(?:\/\.bin\/(?:cli|ruflo)|\/@claude-flow\/cli\/bin\/cli\.js|\/ruflo\/bin\/ruflo\.js|\/cli\.js)\b/, '');
  const first = (after.split(/\s+/).filter((a) => a && !a.startsWith('-'))[0]) || '';
  if (first === 'mcp') return 'mcp';
  if (first === 'daemon') return 'daemon';
  if (first === '') return 'server';   // no subcommand = the plugin's default stdio MCP server
  return null;                          // a one-shot subcommand — not a persistent writer
}

// Every running process as { pid, ageSec, cmd }. `ps -Awwo` — the double-w defeats the
// command-line truncation that would hide the subcommand and the cli path we match on. Codex and
// Claude sessions can make the machine-wide argv stream exceed Node's small default buffer (12.5 MB
// measured here); 64 MB keeps that bounded without turning ENOBUFS into a false "no stale writers".
function processes() {
  let out;
  try { out = execFileSync('ps', ['-Awwo', 'pid=,command='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
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
 * `pids` is an explicit candidate allowlist for isolated tests; production callers omit it and
 * retain the required machine-wide scan.
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
export function staleWriters({ now = Date.now(), pids = null } = {}) {
  if (!readState().patchTargets.includes('memory')) return [];

  const self = process.pid;
  const allowed = Array.isArray(pids) ? new Set(pids.map(Number)) : null;
  const out = [];
  for (const { pid, cmd } of processes()) {
    if (pid === self) continue;
    if (allowed && !allowed.has(pid)) continue;
    const kind = roleOf(cmd);
    if (!kind) continue;
    const cliRoot = cliRootOf(cmd);
    if (!cliRoot) continue; // an npm-exec wrapper or an unresolvable path — never touch it

    const mi = `${cliRoot}/dist/src/memory/memory-initializer.js`;
    let src, mtimeMs;
    try { const st = fs.statSync(mi); mtimeMs = st.mtimeMs; src = fs.readFileSync(mi, 'utf8'); }
    catch { continue; } // no memory module at that root — not a memory writer we can assess

    if (!PATCHED_NEEDLES.every((needle) => src.includes(needle))) {
      out.push({ pid, kind, cliRoot, severity: 'unpatched', reason: 'running an @claude-flow/cli copy without the current fail-closed write lock (the memory patch never reached this copy, or an older fail-open patch remains)' });
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

// A daemon can be restarted automatically because it respawns on next use. An MCP client cannot:
// VALIDATED LIVE (2026-07-17 and again 2026-09-08), killing its stdio child permanently changes the
// host transport to `Transport closed` until a human reconnects inside that exact session. A detached
// monitor cannot perform that second step. Therefore unattended recovery NEVER signals MCP clients.
//
// 'unpatched' writers (any kind) are still NEVER auto-killed: the copy on disk has no lock because
// the patch could not be applied, so ANY respawn — daemon or, after a manual reconnect, MCP client —
// reads the same unpatched copy and gains nothing. That is patch drift, fixed by re-anchoring, which
// the drift machinery already surfaces; killing the process here would only add a needless outage.
const isAutoRestartable = (w) => w.severity === 'pre-patch' && w.kind === 'daemon';

/** Human-facing lines for the SessionStart hook — warns about every stale writer. */
export function describeStaleWriters(writers) {
  if (!writers.length) return [];
  const restartableDaemons = writers.filter((w) => isAutoRestartable(w) && w.kind === 'daemon');
  const restartableMcp = writers.filter((w) => w.severity === 'pre-patch' && w.kind !== 'daemon');
  const unpatched = writers.filter((w) => w.severity === 'unpatched');
  const lines = [`[ruflo-source-patch] ${writers.length} stale memory writer(s) running old code against .swarm/memory.db:`];
  for (const w of writers.slice(0, 8)) lines.push(`  pid=${w.pid} (${w.kind}) ${w.severity} — ${w.reason}`);
  if (restartableDaemons.length) lines.push('  pre-patch daemons: the monitor restarts these (they respawn patched) unless RSP_NO_STALE_WRITER_KILL is set; now: monitor run');
  if (restartableMcp.length) {
    lines.push(`  pre-patch MCP client(s) need a controlled host reconnect and WILL NOT be killed by the monitor: ${restartableMcp.map((w) => w.pid).join(', ')}`);
    lines.push('  ACTION REQUIRED in each affected session: reconnect Ruflo through that host before relying on the new patch bytes.');
  }
  if (unpatched.length) lines.push('  unpatched writer(s): the patch could not be applied to that copy (drift) — a respawn would just reload unpatched. Check: monitor check');
  return lines;
}

/**
 * The monitor's action: restart only pre-patch DAEMONS. An MCP stdio child is part of its host's
 * live transport; killing it cannot reconnect it and turns a recoverable freshness warning into an
 * outage. MCP clients and unpatched writers are detected and reported but never signalled.
 * Guarded — only ever signals a process staleWriters() positively identified. `dryRun` reports
 * without killing; KILL_DISABLED() reports without killing. The optional `pids` allowlist exists
 * only so the real-process regression cannot signal an unrelated live session. Returns
 * { detected, killed, log }.
 */
export function recoverStaleWriters({ dryRun = false, pids = null } = {}) {
  const writers = staleWriters({ pids });
  const log = [];
  if (!writers.length) return { detected: [], killed: [], log };

  const killed = [];
  const suppressed = dryRun || KILL_DISABLED();
  for (const w of writers) {
    if (!isAutoRestartable(w)) {
      const why = w.kind !== 'daemon' && w.severity === 'pre-patch'
        ? 'detached monitor cannot reconnect host stdio; controlled reconnect required'
        : 'unpatched copy, a respawn would loop unpatched; re-anchor the patch (drift)';
      log.push(`NOT killed pid=${w.pid} (${w.kind}, ${w.severity}) — ${why} — ${w.reason}`);
      continue;
    }
    const how = 'respawns patched on next use';
    if (suppressed) { log.push(`${dryRun ? 'would kill' : `${w.severity} (kill disabled)`} pid=${w.pid} (${w.kind}) — ${how} — ${w.reason}`); continue; }
    try {
      process.kill(w.pid, 'SIGTERM');
      killed.push(w);
      log.push(`restarted pre-patch daemon pid=${w.pid} — ${how} — ${w.reason}`);
    } catch (e) { log.push(`could not kill pid=${w.pid}: ${e.message}`); }
  }
  return { detected: writers, killed, log };
}
