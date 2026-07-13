// The source patcher for the installed @claude-flow/cli + @claude-flow/cli-core.
//
// 6 targets across 3 fix families (keep this count in sync with README.md):
//
//   cwd anchoring — resolve the nearest ancestor .git instead of raw process.cwd():
//     1. daemon-autostart        services/daemon-autostart.js
//     2. memory-initializer      memory/memory-initializer.js   (getMemoryRoot)
//     3. cli-core getProjectCwd  mcp-tools/types.js
//     4. daemon-command          commands/daemon.js             (dedup was keyed per-CWD)
//
//   memory durability — .swarm/memory.db (ruvnet/ruflo#2584 follow-ups):
//     5. fs-secure wal-safety    fs-secure.js                   (WAL-coherent reads)
//        + the cross-process write lock injected into target 2  (#2621)
//
//   daemon dedup — old/forked builds that predate the #2407/#2484 spawn lock:
//     6. daemon-dedup            commands/daemon.js
//
// Idempotent (PATCH_MARKER), reversible (per-file .rsp-backup), safe-fail on
// version drift (exact-anchor check before any write).

import fs from 'node:fs';
import path from 'node:path';
import { NPX_ROOT, PATCH_MARKER } from './paths.mjs';

const MARKER = PATCH_MARKER;

// Injected resolver (ESM form — uses createRequire since the targets are ESM).
const RESOLVER_SRC_ESM = `${MARKER}
import { createRequire as __rufloCreateRequire } from 'module';
const __rufloReq = __rufloCreateRequire(import.meta.url);
function __rufloResolveRoot(startDir) {
  try {
    const fs = __rufloReq('fs'); const path = __rufloReq('path');
    let dir = path.resolve(startDir || process.cwd());
    for (let i = 0; i < 40; i++) {
      if (fs.existsSync(path.join(dir, '.git'))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch { /* fall through */ }
  return startDir || process.cwd();
}
`;

// WAL-safety prelude (fs-secure.js). The sql.js paths in memory-initializer do a
// whole-file read-modify-write (`db.export()` → atomic rename) on a database that
// better-sqlite3 (AgentDB bridge) keeps in WAL mode. Two consequences, both real:
//
//   1. READ: sql.js cannot see WAL frames, so it reads a stale image missing every
//      row still sitting in `-wal` (upstream ruvnet/claude-flow#2652: "read/write
//      paths disagree on row visibility").
//   2. WRITE: the atomic rename installs a NEW image while the OLD `-wal` survives.
//      Its frames carry page numbers for the previous image, so the next
//      better-sqlite3 open replays them onto a different file → "invalid page
//      number" / "overflow list length" corruption. Atomicity (#2584) does not help;
//      it makes the bad image complete rather than torn.
//
// Fix: checkpoint(TRUNCATE) before any read of a *.db, so sql.js gets a COMPLETE
// image. After the checkpoint the WAL is zero-length, and a zero-length WAL replays
// nothing — so the subsequent full-image rename is coherent with no further action.
//
// Deliberately NOT done: unlinking -wal/-shm after the swap. `-shm` is SQLite's
// shared-memory lock index for WAL mode; unlinking it while another process holds an
// open connection leaves the survivor on the old (unlinked) inode while a newcomer
// creates a fresh one — the two stop sharing locking state, producing unsynchronised
// writers. That is the very failure class this patch exists to prevent, and the
// checkpoint already makes the unlink redundant.
//
// SCOPE — this is NOT a substitute for the cross-process advisory lock ruvnet named
// as follow-up #2 in the ruvnet/ruflo#2584 close-out. It provides NO mutual exclusion:
// two processes can each checkpoint, each read a complete image, and each rename — the
// second silently clobbers the first (ruvnet/ruflo#2621, last-writer-wins). This patch
// fixes the STALE-READ half only (sql.js cannot see WAL frames at all); serialising
// writers still requires the real lock.
const WAL_SAFETY_SRC_ESM = `${MARKER}
import { createRequire as __rufloCreateRequire } from 'module';
const __rufloReq = __rufloCreateRequire(import.meta.url);
function __rufloIsDb(p) {
  return typeof p === 'string' && /\\.db$/.test(p);
}
function __rufloCheckpointWal(p) {
  try {
    if (!__rufloIsDb(p)) return;
    const nfs = __rufloReq('fs');
    const wal = p + '-wal';
    if (!nfs.existsSync(p)) return;
    if (!nfs.existsSync(wal) || nfs.statSync(wal).size === 0) return;
    const Database = __rufloReq('better-sqlite3');
    const d = new Database(p);
    try { d.pragma('wal_checkpoint(TRUNCATE)'); } finally { d.close(); }
  } catch { /* best-effort: never break a read */ }
}
`;

// Cross-process single-writer advisory lock for the memory store.
//
// This is ruvnet's follow-up #2 from the ruvnet/ruflo#2584 close-out ("a cross-process
// advisory lock between the daemon and MCP server"), still unbuilt upstream, and the
// cause of ruvnet/ruflo#2621 (daemon <-> MCP last-writer-wins silently DROPS writes).
//
// Why a lock is unavoidable: storeEntry/getEntry/deleteEntry each do a whole-file
// read-modify-write (`db.export()` -> atomic rename). Two processes can each read image
// v1, then each rename — the second clobbers the first. Only mutual exclusion spanning
// read..write fixes that; no amount of per-write atomicity can.
//
// Reuses the exact primitive ruflo already ships in commands/daemon.js (#2484):
// O_CREAT|O_EXCL lockfile + PID + stale-file recovery.
//
// Design constraints:
//   - REENTRANT: storeEntry internally calls getEntry/addToHNSWIndex; a non-reentrant
//     lock would self-deadlock. Refcount per (process, path).
//   - NEVER HARD-FAIL: if the lock can't be taken (read-only fs, 5s timeout), proceed
//     UNLOCKED rather than break the memory op. Degrades to today's behaviour, never worse.
//   - STALE RECOVERY: a lockfile older than 15s is stolen (holder died mid-write);
//     plus a process-exit hook unlinks anything still held.
const LOCK_SRC_ESM = `
const __rufloLocks = new Map();
async function __rufloLockAcquire(p) {
  if (!p || typeof p !== 'string') return null;
  const held = __rufloLocks.get(p);
  if (held) { held.count++; return held; }
  let nfs;
  try { nfs = __rufloReq('fs'); } catch { return null; }
  const lockFile = p + '.rsp-lock';
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      const fd = nfs.openSync(lockFile, nfs.constants.O_CREAT | nfs.constants.O_EXCL | nfs.constants.O_WRONLY);
      try { nfs.writeSync(fd, String(process.pid)); } catch { /* pid is advisory only */ }
      const h = { fd, lockFile, count: 1 };
      __rufloLocks.set(p, h);
      return h;
    } catch (e) {
      if (!e || e.code !== 'EEXIST') return null;
      try {
        const st = nfs.statSync(lockFile);
        if (Date.now() - st.mtimeMs > 15000) { try { nfs.unlinkSync(lockFile); } catch {} continue; }
      } catch { continue; }
      if (Date.now() > deadline) return null;
      await new Promise((r) => setTimeout(r, 15 + Math.floor(Math.random() * 25)));
    }
  }
}
function __rufloLockRelease(p, h) {
  if (!h) return;
  if (--h.count > 0) return;
  __rufloLocks.delete(p);
  let nfs;
  try { nfs = __rufloReq('fs'); } catch { return; }
  try { nfs.closeSync(h.fd); } catch {}
  try { nfs.unlinkSync(h.lockFile); } catch {}
}
try {
  process.on('exit', () => {
    for (const [, h] of __rufloLocks) {
      try { __rufloReq('fs').unlinkSync(h.lockFile); } catch {}
    }
  });
} catch { /* no process hook available */ }
`;

// Appended at EOF: wrap the five read-modify-write entry points in the lock.
// ESM function declarations are mutable bindings and exports are LIVE, so reassigning
// them here transparently locks every caller (including the daemon and the MCP server).
// storeEntry tries the AgentDB bridge FIRST, so wrapping the whole function serialises
// both engines — which is the point: the race is bridge-write vs full-image-flush.
const LOCK_WRAP_SRC = `
{
  const __rufloPathOf = (v) => {
    try {
      if (typeof v === 'string' && v) return v;
      if (v && typeof v === 'object' && typeof v.dbPath === 'string' && v.dbPath) return v.dbPath;
      return resolveDbPath(undefined);
    } catch { return null; }
  };
  const __rufloGuard = (fn) => async function (arg) {
    const p = __rufloPathOf(arg);
    const h = await __rufloLockAcquire(p);
    try { return await fn.call(this, arg); } finally { __rufloLockRelease(p, h); }
  };
  storeEntry = __rufloGuard(storeEntry);
  getEntry = __rufloGuard(getEntry);
  deleteEntry = __rufloGuard(deleteEntry);
  applyTemporalDecay = __rufloGuard(applyTemporalDecay);
  ensureSchemaColumns = __rufloGuard(ensureSchemaColumns);
}
//# sourceMappingURL=memory-initializer.js.map`;

// Prelude for the daemon-dedup target: the same O_EXCL lockfile primitive upstream
// added in #2407/#2484, at the same path (<root>/.claude-flow/daemon.lock) so patched
// old builds and modern builds dedup against each other.
//
// Synchronous on purpose — it wraps a sync dedup check in the CLI's start path.
// EEXIST => a sibling is mid-spawn: wait for it to publish a live PID, then report
// 'already-running' (dedup success) rather than forking a competing daemon.
const DAEMON_LOCK_SRC_ESM = `${MARKER}
import { createRequire as __rufloCreateRequire } from 'module';
const __rufloReq = __rufloCreateRequire(import.meta.url);
function __rufloDaemonLockAcquire(projectRoot) {
  let nfs, npath;
  try { nfs = __rufloReq('fs'); npath = __rufloReq('path'); } catch { return null; }
  const stateDir = npath.join(npath.resolve(projectRoot), '.claude-flow');
  const lockFile = npath.join(stateDir, 'daemon.lock');
  const pidFile = npath.join(stateDir, 'daemon.pid');
  try { nfs.mkdirSync(stateDir, { recursive: true }); } catch {}
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      const fd = nfs.openSync(lockFile, nfs.constants.O_CREAT | nfs.constants.O_EXCL | nfs.constants.O_WRONLY);
      try { nfs.writeSync(fd, String(process.pid)); } catch {}
      return { fd, lockFile };
    } catch (e) {
      if (!e || e.code !== 'EEXIST') return null;
      // A sibling holds the lock. If it publishes a LIVE pid, we are done — dedup.
      try {
        const pid = parseInt(String(nfs.readFileSync(pidFile, 'utf8')).trim(), 10);
        if (pid > 0) { try { process.kill(pid, 0); return 'already-running'; } catch {} }
      } catch {}
      // Stale lock (holder died mid-spawn) -> steal it.
      try {
        const st = nfs.statSync(lockFile);
        if (Date.now() - st.mtimeMs > 30000) { try { nfs.unlinkSync(lockFile); } catch {} continue; }
      } catch { continue; }
      if (Date.now() > deadline) return null; // never block a start forever
      try { __rufloReq('child_process').execFileSync('sleep', ['0.1']); } catch {}
    }
  }
}
function __rufloDaemonLockRelease(h) {
  if (!h || h === 'already-running') return;
  let nfs;
  try { nfs = __rufloReq('fs'); } catch { return; }
  try { nfs.closeSync(h.fd); } catch {}
  try { nfs.unlinkSync(h.lockFile); } catch {}
}
`;

const TARGETS = [
  {
    label: 'fs-secure wal-safety',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'fs-secure.js'],
    prelude: WAL_SAFETY_SRC_ESM,
    edits: [
      {
        find: "export function readFileMaybeEncrypted(path, encoding = 'utf-8') {\n    const raw = readFileSync(path);",
        replace: "export function readFileMaybeEncrypted(path, encoding = 'utf-8') {\n    __rufloCheckpointWal(path);\n    const raw = readFileSync(path);",
      },
    ],
  },
  {
    // The `daemon start|stop|status` COMMAND itself, in the CURRENT @claude-flow/cli.
    //
    // Distinct from the `daemon-dedup (pre-#2407 builds)` target below: that one adds the
    // MISSING spawn lock to old/forked builds. This one fixes a gap that is still live in
    // up-to-date upstream (verified on 3.25.6, which HAS the #2484 lock): commands/daemon.js
    // anchors its own state — `.claude-flow/`, `daemon.pid`, and the #2484 dedup lockfile —
    // to raw process.cwd(). So dedup is keyed PER-CWD, not per-project.
    //
    // Patching daemon-autostart.js is not enough; the CLI command has its own resolution.
    // Measured on 3.25.6 with the rest of the cwd patch already applied:
    //
    //   6 concurrent `daemon start` from the repo ROOT      -> 1 daemon   (dedup works)
    //   6 concurrent `daemon start` from 6 SUBDIRS of it    -> 6 daemons, 6 .claude-flow dirs
    //
    // Hooks, sub-agents and worktrees routinely invoke the CLI with a drifted cwd, which is
    // how one project accumulates daemons. Resolving to the project root makes the existing
    // #2484 lockfile/PID dedup actually bind across all of them (-> 1 daemon), and makes
    // `daemon status`/`stop` from a subdirectory find the root daemon instead of reporting
    // "not running".
    //
    // NOT patched on purpose: `const cwd = process.cwd();` (the "allow only paths within
    // project structure" guard). That is a path-validation security boundary, not state
    // anchoring — widening it to the repo root would loosen it for zero dedup benefit.
    label: 'daemon-command',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'commands', 'daemon.js'],
    edits: [
      {
        find: "        const projectRoot = resolveWorkspaceFlag(ctx.flags.workspace) ?? process.cwd();",
        replace: "        const projectRoot = resolveWorkspaceFlag(ctx.flags.workspace) ?? __rufloResolveRoot(process.cwd());",
      },
      {
        // 3 identical call sites — all state-anchoring.
        find: "        const projectRoot = process.cwd();",
        replace: "        const projectRoot = __rufloResolveRoot(process.cwd());",
        all: true,
      },
      {
        // 2 identical call sites — locating the daemon handle for status/stop.
        find: "            const daemon = getDaemon(process.cwd());",
        replace: "            const daemon = getDaemon(__rufloResolveRoot(process.cwd()));",
        all: true,
      },
    ],
  },
  {
    label: 'daemon-autostart',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'services', 'daemon-autostart.js'],
    edits: [
      {
        find: "        if (autostartDisabled())\n            return { started: false, reason: 'disabled (RUFLO_DAEMON_AUTOSTART=0)' };",
        replace: "        if (autostartDisabled())\n            return { started: false, reason: 'disabled (RUFLO_DAEMON_AUTOSTART=0)' };\n        projectRoot = __rufloResolveRoot(projectRoot);",
      },
    ],
  },
  {
    label: 'memory-initializer',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'memory', 'memory-initializer.js'],
    prelude: RESOLVER_SRC_ESM + LOCK_SRC_ESM,
    edits: [
      {
        // Cross-process single-writer lock (#2584 follow-up #2 / #2621).
        find: "//# sourceMappingURL=memory-initializer.js.map",
        replace: LOCK_WRAP_SRC,
      },
      {
        find: "        path.resolve(process.cwd(), 'claude-flow.config.json'),",
        replace: "        path.resolve(__rufloResolveRoot(process.cwd()), 'claude-flow.config.json'),",
      },
      {
        find: "        path.resolve(process.cwd(), '.claude-flow', 'config.json'),",
        replace: "        path.resolve(__rufloResolveRoot(process.cwd()), '.claude-flow', 'config.json'),",
      },
      {
        find: "    _memoryRootCache = path.resolve(process.cwd(), '.swarm');",
        replace: "    _memoryRootCache = path.resolve(__rufloResolveRoot(process.cwd()), '.swarm');",
      },
    ],
  },
  {
    label: 'cli-core getProjectCwd',
    suffix: ['@claude-flow', 'cli-core', 'dist', 'src', 'mcp-tools', 'types.js'],
    edits: [
      {
        find: "    return process.cwd();",
        replace: "    return __rufloResolveRoot(process.cwd());",
      },
    ],
  },
  // Daemon dedup for CLI builds that PREDATE upstream's atomic lockfile
  // (ruvnet/ruflo#2407, #2484). Those builds do: read daemon.pid -> not running ->
  // killStaleDaemons -> spawn, with NO lock. N concurrent `daemon start` calls all
  // see an empty PID file in the same instant and each fork their own daemon.
  //
  // Observed in the wild on @sparkleideas/cli 3.7.0-alpha.10-patch.446:
  // 38 daemons on ONE cwd, still spawning ~1/5min, all orphaned to ppid=1, and
  // INVISIBLE to `daemon status --all` (its registry only tracks @claude-flow/cli).
  // #2407 reports the same shape upstream: 39 zombie daemons -> ~8.5 GiB -> kernel panic.
  //
  // Upstream >=3.25 already holds an O_EXCL daemon.lock across the whole spawn, so this
  // target's anchor does not match there and is safe-skipped (never double-locked).
  //
  // The lockfile path is <projectRoot>/.claude-flow/daemon.lock — the SAME path upstream
  // uses — so a patched old build and a modern build dedup against EACH OTHER, which is
  // what the cross-package blindness needs.
  {
    label: 'daemon-dedup (pre-#2407 builds)',
    suffix: ['@sparkleideas', 'cli', 'dist', 'src', 'commands', 'daemon.js'],
    prelude: DAEMON_LOCK_SRC_ESM,
    edits: [
      {
        find: `        // Check if background daemon already running (skip if we ARE the daemon process)
        if (!isDaemonProcess) {
            const bgPid = getBackgroundDaemonPid(projectRoot);
            if (bgPid && isProcessRunning(bgPid)) {
                if (!quiet) {
                    output.printWarning(\`Daemon already running in background (PID: \${bgPid}). Stop it first with: daemon stop\`);
                }
                return { success: true };
            }
            // #1551: Kill any stale daemon processes that weren't tracked by PID file
            await killStaleDaemons(projectRoot, quiet);
        }
        // Background mode (default): fork a detached process
        if (!foreground) {
            return startBackgroundDaemon(projectRoot, quiet, rawMaxCpu, rawMinMem);
        }`,
        replace: `        // ruflo-source-patch: hold an O_EXCL lock across dedup-check + spawn so N
        // concurrent \`daemon start\` calls cannot each fork a daemon (#2407/#2484).
        let __rufloDLock = null;
        if (!isDaemonProcess) {
            __rufloDLock = __rufloDaemonLockAcquire(projectRoot);
            if (__rufloDLock === 'already-running') {
                if (!quiet) {
                    output.printWarning('Daemon already running for this project — not spawning another.');
                }
                return { success: true };
            }
            const bgPid = getBackgroundDaemonPid(projectRoot);
            if (bgPid && isProcessRunning(bgPid)) {
                if (!quiet) {
                    output.printWarning(\`Daemon already running in background (PID: \${bgPid}). Stop it first with: daemon stop\`);
                }
                __rufloDaemonLockRelease(__rufloDLock);
                return { success: true };
            }
            // #1551: Kill any stale daemon processes that weren't tracked by PID file
            await killStaleDaemons(projectRoot, quiet);
        }
        // Background mode (default): fork a detached process
        if (!foreground) {
            try {
                return await startBackgroundDaemon(projectRoot, quiet, rawMaxCpu, rawMinMem);
            } finally {
                __rufloDaemonLockRelease(__rufloDLock);
            }
        }
        // Foreground: release before blocking; startDaemon() writes the PID file.
        __rufloDaemonLockRelease(__rufloDLock);`,
      },
    ],
  },
];

function discover(suffix) {
  const found = [];
  let hashes;
  try { hashes = fs.readdirSync(NPX_ROOT); } catch { return found; }
  for (const h of hashes) {
    const full = path.join(NPX_ROOT, h, 'node_modules', ...suffix);
    if (fs.existsSync(full)) found.push(full);
  }
  return found;
}

// Blind-spot detector. `discover()` is suffix-driven, so a ruflo CLI published under a
// package name we don't list gets ZERO protection — silently. That is exactly how 38
// daemons accumulated on one cwd from @sparkleideas/cli while `daemon status --all`
// reported "6 daemons, all within TTL". Surface any ruflo-shaped CLI we are NOT covering.
const KNOWN_CLI_PKGS = ['@claude-flow/cli', '@sparkleideas/cli'];

export function scanUncoveredBuilds() {
  const seen = new Set();
  let hashes;
  try { hashes = fs.readdirSync(NPX_ROOT); } catch { return []; }
  for (const h of hashes) {
    const scopeRoot = path.join(NPX_ROOT, h, 'node_modules');
    let scopes;
    try { scopes = fs.readdirSync(scopeRoot); } catch { continue; }
    for (const scope of scopes) {
      if (!scope.startsWith('@')) continue;
      let pkgs;
      try { pkgs = fs.readdirSync(path.join(scopeRoot, scope)); } catch { continue; }
      for (const p of pkgs) {
        const name = `${scope}/${p}`;
        if (KNOWN_CLI_PKGS.includes(name)) continue;
        const root = path.join(scopeRoot, scope, p);
        // Only a build that can actually SPAWN A DAEMON matters here. Libraries
        // (cli-core, neural, agentdb, …) have no daemon path and no memory root.
        if (!fs.existsSync(path.join(root, 'dist', 'src', 'commands', 'daemon.js'))) continue;
        let meta;
        try { meta = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); } catch { continue; }
        seen.add(`uncovered ruflo CLI: ${name}@${meta.version} — can spawn daemons, but no patches cover it (add it to KNOWN_CLI_PKGS)`);
      }
    }
  }
  return [...seen];
}

function patchFile(file, target) {
  const backup = `${file}.rsp-backup`;
  let src = fs.readFileSync(file, 'utf8');
  if (src.includes(MARKER)) return 'already-patched';
  for (const e of target.edits) {
    if (!src.includes(e.find)) return `skip:anchor-not-found`;
  }
  if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
  src = (target.prelude || RESOLVER_SRC_ESM) + '\n' + src;
  // `all: true` — the anchor occurs at several call sites that must ALL be rewritten
  // (e.g. `const projectRoot = process.cwd();` appears 3x in commands/daemon.js).
  // String.prototype.replace with a string pattern only replaces the FIRST match.
  for (const e of target.edits) {
    src = e.all ? src.split(e.find).join(e.replace) : src.replace(e.find, e.replace);
  }
  fs.writeFileSync(file, src);
  return 'patched';
}

function revertFile(file) {
  const backup = `${file}.rsp-backup`;
  if (!fs.existsSync(backup)) return 'no-backup';
  fs.copyFileSync(backup, file);
  fs.unlinkSync(backup);
  return 'reverted';
}

// Programmatic API. Returns { patched, skipped, reverted, log[] }.
export function run({ revert = false } = {}) {
  const result = { patched: 0, skipped: 0, reverted: 0, log: [] };
  for (const target of TARGETS) {
    for (const file of discover(target.suffix)) {
      try {
        if (revert) {
          if (revertFile(file) === 'reverted') { result.reverted++; result.log.push(`reverted ${target.label}: ${file}`); }
        } else {
          const r = patchFile(file, target);
          if (r === 'patched') { result.patched++; result.log.push(`patched ${target.label}: ${file}`); }
          else if (r.startsWith('skip')) { result.skipped++; result.log.push(`${r} (${target.label}): ${file}`); }
        }
      } catch (err) {
        result.log.push(`error ${file}: ${err.message}`);
      }
    }
  }
  if (!revert) {
    for (const w of scanUncoveredBuilds()) result.log.push(`WARN ${w}`);
  }
  return result;
}
