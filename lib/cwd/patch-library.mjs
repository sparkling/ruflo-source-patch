// The source patcher for the installed @claude-flow/cli + @claude-flow/cli-core.
//
// ── Independent targets ──────────────────────────────────────────────────────
// Each CLI target installs/uninstalls ON ITS OWN. That is only possible because
// files are rebuilt FROM A PRISTINE BACKUP on every apply:
//
//     pristine (.rsp-backup)  ->  prelude(fragments of active entries)  ->  edits
//
// The old scheme (one marker + one backup per file, edits applied in place) could
// not support this: `memory/memory-initializer.js` is patched by TWO targets — `cwd`
// (getMemoryRoot / config paths) and `memory` (the write lock) — so uninstalling one
// would have to un-apply its edits while leaving the other's intact. Rebuilding from
// pristine makes install/uninstall of any subset trivially correct and idempotent:
// the file is always exactly `pristine + the entries currently asked for`.
//
// ── Targets ─────────────────────────────────────────────────────────────────
//   cwd     cwd anchoring — resolve nearest ancestor .git instead of raw process.cwd()
//           (ruvnet/ruflo#2633). Stops .claude-flow/.swarm sprawl under cwd drift.
//   daemon  daemon dedup — one daemon per project ROOT
//           (#2633 keying + #2407/#2484 spawn lock for old/forked builds).
//   memory  .swarm/memory.db durability — cross-process write lock (#2621) and
//           WAL-coherent reads (#2584 follow-ups).
//
// Idempotent, reversible (per-file `.rsp-backup` = the untouched vendor file), and
// safe-fail on version drift: an entry whose anchor no longer matches is skipped
// individually — never a partial write, and never blocks the other entries.

import fs from 'node:fs';
import path from 'node:path';
import { NPX_ROOT, GLOBAL_ROOTS, PATCH_MARKER } from './paths.mjs';

const MARKER = PATCH_MARKER;

export const PATCH_TARGETS = ['cwd', 'daemon', 'memory'];

export const TARGET_INFO = {
  cwd: 'cwd anchoring — .claude-flow/.swarm stop following a drifted cwd (#2633)',
  daemon: 'daemon dedup — one daemon per project root (#2633 / #2407 / #2484)',
  memory: 'memory.db durability — write lock (#2621) + WAL-coherent reads (#2584)',
};

// ─── Injected code fragments ─────────────────────────────────────────────────
// Composable and de-duplicated: several entries can land in ONE file, so each
// fragment is emitted at most once, after its deps. `req` is the shared base —
// without it, installing `memory` WITHOUT `cwd` would inject the lock (which uses
// __rufloReq) into a file that never declared it.

const FRAGMENTS = {
  req: {
    deps: [],
    src: `import { createRequire as __rufloCreateRequire } from 'module';
const __rufloReq = __rufloCreateRequire(import.meta.url);`,
  },

  // Project root = nearest ancestor containing .git (worktree-safe).
  resolveRoot: {
    deps: ['req'],
    src: `function __rufloResolveRoot(startDir) {
  try {
    const nfs = __rufloReq('fs'); const npath = __rufloReq('path');
    let dir = npath.resolve(startDir || process.cwd());
    for (let i = 0; i < 40; i++) {
      if (nfs.existsSync(npath.join(dir, '.git'))) return dir;
      const parent = npath.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch { /* fall through */ }
  return startDir || process.cwd();
}`,
  },

  // sql.js cannot read WAL frames, so a bare readFileSync on a WAL-mode DB returns a
  // STALE image — measured: "no such table: memory_entries" while 500 rows sat in a
  // 2.3MB -wal — which the caller then writes back over the real image.
  // Checkpoint(TRUNCATE) first so the image is complete.
  //
  // Deliberately NOT unlinking -wal/-shm afterwards: -shm is SQLite's shared-memory
  // LOCK INDEX; unlinking it while another process holds a connection splits the two
  // onto different lock state — manufacturing the unsynchronised writers this exists
  // to prevent. After a TRUNCATE checkpoint the WAL is zero-length and replays
  // nothing, so the unlink is redundant anyway.
  walCheckpoint: {
    deps: ['req'],
    src: `function __rufloIsDb(p) {
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
}`,
  },

  // Cross-process single-writer lock for .swarm/memory.db — ruvnet's follow-up #2 from
  // the #2584 close-out, still unbuilt upstream, and the cause of #2621 (daemon <-> MCP
  // last-writer-wins SILENTLY DROPS writes: measured 50 acked, 25 on disk).
  //
  // storeEntry/getEntry/deleteEntry each do a whole-file read-modify-write, so two
  // processes can each read image v1 and each rename — the second clobbers the first.
  // Only mutual exclusion spanning read..write fixes it.
  //
  //  - REENTRANT: storeEntry calls getEntry internally; a naive lock self-deadlocks.
  //  - NEVER HARD-FAILS: on timeout / read-only fs it proceeds UNLOCKED, degrading to
  //    current behaviour rather than breaking memory.
  //  - STALE RECOVERY: >15s lock is stolen (holder died mid-write) + exit-hook unlink.
  memLock: {
    deps: ['req'],
    src: `const __rufloLocks = new Map();
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
} catch { /* no process hook available */ }`,
  },

  // The O_EXCL spawn lock upstream added in #2407/#2484, at the SAME path
  // (<root>/.claude-flow/daemon.lock) so a patched old build and a modern build dedup
  // against EACH OTHER. Synchronous on purpose — it wraps a sync dedup check.
  daemonLock: {
    deps: ['req'],
    src: `function __rufloDaemonLockAcquire(projectRoot) {
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
      try {
        const pid = parseInt(String(nfs.readFileSync(pidFile, 'utf8')).trim(), 10);
        if (pid > 0) { try { process.kill(pid, 0); return 'already-running'; } catch {} }
      } catch {}
      try {
        const st = nfs.statSync(lockFile);
        if (Date.now() - st.mtimeMs > 30000) { try { nfs.unlinkSync(lockFile); } catch {} continue; }
      } catch { continue; }
      if (Date.now() > deadline) return null;
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
}`,
  },
};

function composePrelude(fragIds) {
  const seen = new Set();
  const out = [];
  const visit = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    const f = FRAGMENTS[id];
    if (!f) throw new Error(`unknown fragment: ${id}`);
    for (const d of f.deps) visit(d);
    out.push(f.src);
  };
  for (const id of fragIds) visit(id);
  return out.length ? `${MARKER}\n${out.join('\n')}\n` : '';
}

// EOF wrapper for the memory write lock. ESM function declarations are mutable
// bindings and exports are LIVE, so reassigning them here transparently locks every
// caller — the daemon and the MCP server alike. storeEntry tries the AgentDB bridge
// FIRST, so wrapping the WHOLE function serialises both engines, which is the point:
// the race is bridge-write vs full-image-flush.
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

// ─── Entries ─────────────────────────────────────────────────────────────────
// One entry = one coherent edit-set on one file, owned by exactly one target.
// Several entries may share a file (see memory-initializer): the rebuild composes them.

const ENTRIES = [
  // ── target: cwd ────────────────────────────────────────────────────────────
  {
    id: 'cwd/daemon-autostart',
    target: 'cwd',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'services', 'daemon-autostart.js'],
    frags: ['resolveRoot'],
    edits: [
      // Anchored on the function head, not on the autostart-disabled check.
      //
      // The old anchor was the `if (autostartDisabled())` line plus its exact `reason`
      // string. 3.26.0 changed both — `autostartDisabled(projectRoot)` now takes the root,
      // and the reason gained "or project config" — so the anchor stopped matching and this
      // patch silently stopped applying: #2633 sprawl, quietly back. (Caught by the
      // SessionStart notifier the day 3.26.1 landed, which is exactly what it is for.)
      //
      // The function head is stable across 3.25.1 / 3.26.0 / 3.26.1, and resolving here is
      // also strictly MORE correct: 3.26 reads a project-local `claude-flow.config.json`
      // inside autostartDisabled(projectRoot), so the root must already be resolved when
      // that check runs. Under the old anchor it was resolved one line too late, and the
      // opt-out was read relative to a drifted cwd.
      {
        find: 'export function ensureDaemonRunning(projectRoot, opts = {}) {\n    try {',
        replace: 'export function ensureDaemonRunning(projectRoot, opts = {}) {\n    try {\n        projectRoot = __rufloResolveRoot(projectRoot);',
      },
    ],
  },
  {
    id: 'cwd/memory-root',
    target: 'cwd',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'memory', 'memory-initializer.js'],
    frags: ['resolveRoot'],
    edits: [
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
    id: 'cwd/cli-core-getProjectCwd',
    target: 'cwd',
    suffix: ['@claude-flow', 'cli-core', 'dist', 'src', 'mcp-tools', 'types.js'],
    frags: ['resolveRoot'],
    edits: [
      {
        find: "    return process.cwd();",
        replace: "    return __rufloResolveRoot(process.cwd());",
      },
    ],
  },

  // ── target: daemon ─────────────────────────────────────────────────────────
  // The `daemon start|stop|status` COMMAND in the CURRENT @claude-flow/cli.
  // Gap is live in up-to-date upstream (verified on 3.25.6, which HAS the #2484 lock):
  // commands/daemon.js anchors .claude-flow/, daemon.pid AND the dedup lockfile to raw
  // process.cwd(), so dedup is keyed PER-CWD, not per-project. Measured on 3.25.6:
  //
  //   6 concurrent `daemon start` from the repo ROOT    -> 1 daemon
  //   6 concurrent `daemon start` from 6 SUBDIRS of it  -> 6 daemons, 6 .claude-flow dirs
  //
  // Resolving to the project root makes the existing lock/PID dedup actually BIND across
  // them (-> 1 daemon), and makes status/stop from a subdir find the root daemon.
  //
  // NOT patched on purpose: `const cwd = process.cwd();` — the "allow only paths within
  // project structure" guard is a security boundary, not state anchoring.
  {
    id: 'daemon/command-root',
    target: 'daemon',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'commands', 'daemon.js'],
    frags: ['resolveRoot'],
    edits: [
      {
        find: "        const projectRoot = resolveWorkspaceFlag(ctx.flags.workspace) ?? process.cwd();",
        replace: "        const projectRoot = resolveWorkspaceFlag(ctx.flags.workspace) ?? __rufloResolveRoot(process.cwd());",
      },
      { find: "        const projectRoot = process.cwd();", replace: "        const projectRoot = __rufloResolveRoot(process.cwd());", all: true },
      { find: "            const daemon = getDaemon(process.cwd());", replace: "            const daemon = getDaemon(__rufloResolveRoot(process.cwd()));", all: true },
    ],
  },
  // Old/forked builds predating #2407/#2484 dedup like this: read daemon.pid -> not
  // running -> killStaleDaemons -> spawn, WITH NO LOCK. N concurrent starts all see an
  // empty PID file in the same instant and each fork a daemon. Upstream >= 3.25 already
  // holds the lock, so this entry safe-skips there (anchor won't match).
  {
    id: 'daemon/spawn-lock-legacy',
    target: 'daemon',
    suffix: ['@sparkleideas', 'cli', 'dist', 'src', 'commands', 'daemon.js'],
    frags: ['daemonLock'],
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

  // ── target: memory ─────────────────────────────────────────────────────────
  {
    id: 'memory/wal-coherent-reads',
    target: 'memory',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'fs-secure.js'],
    frags: ['walCheckpoint'],
    edits: [
      {
        find: "export function readFileMaybeEncrypted(path, encoding = 'utf-8') {\n    const raw = readFileSync(path);",
        replace: "export function readFileMaybeEncrypted(path, encoding = 'utf-8') {\n    __rufloCheckpointWal(path);\n    const raw = readFileSync(path);",
      },
    ],
  },
  {
    id: 'memory/write-lock',
    target: 'memory',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'memory', 'memory-initializer.js'],
    frags: ['memLock'],
    edits: [
      { find: '//# sourceMappingURL=memory-initializer.js.map', replace: LOCK_WRAP_SRC },
    ],
  },
];

// ─── Engine ──────────────────────────────────────────────────────────────────

// Every node_modules dir we patch across: one per npx cache hash, plus each global
// install root. npx nests an extra <hash>/node_modules; a global root IS node_modules.
// Missing roots (no npx cache, no global install) are simply absent — the "skip if it
// doesn't exist" behaviour is inherent: nothing to iterate, nothing to patch.
function nodeModulesDirs() {
  const dirs = [];
  try {
    for (const h of fs.readdirSync(NPX_ROOT)) dirs.push(path.join(NPX_ROOT, h, 'node_modules'));
  } catch { /* no npx cache */ }
  for (const g of GLOBAL_ROOTS) dirs.push(g); // existence checked per-file below
  return dirs;
}

function discover(suffix) {
  const found = [];
  for (const nm of nodeModulesDirs()) {
    const full = path.join(nm, ...suffix);
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
  for (const scopeRoot of nodeModulesDirs()) {
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

const backupOf = (file) => `${file}.rsp-backup`;

// Write only when the bytes actually change, and write ATOMICALLY (temp -> fsync ->
// rename). Both matter now that a scheduled monitor rewrites these files while Claude
// Code sessions are importing them: a plain writeFileSync is not atomic, so an importer
// can read a half-written module. (Same class of bug as ruvnet/ruflo#2584, which is
// half of why this patcher exists — it would be embarrassing to reintroduce it here.)
function writeIfChanged(file, next) {
  let current;
  try { current = fs.readFileSync(file, 'utf8'); } catch { current = null; }
  if (current === next) return false;

  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.rsp-tmp-${process.pid}`);
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx');
    fs.writeFileSync(fd, next);
    fs.fsyncSync(fd);          // durable before the swap
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, file);  // atomic swap — an importer never sees a torn module
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    if (fs.existsSync(tmp)) { try { fs.rmSync(tmp, { force: true }); } catch {} }
  }
  return true;
}

// Is this ENTRY actually applied to this file right now?
//
// Not "does the file contain MARKER" — that is the bug this replaces. memory-initializer.js
// is patched by BOTH `cwd` and `memory`, so a file carrying cwd's edits still has the shared
// MARKER; a MARKER-only check reported "memory live, no drift" with the write lock entirely
// absent. Check the entry's OWN replacement text instead.
function entryApplied(src, entry) {
  return entry.edits.every((e) => src.includes(e.replace));
}

// Is this file OUR output — under any combination of targets?
//
// The MARKER alone is not enough: composePrelude() only emits it when the active entries
// contribute fragments (see :216), so an edits-only entry yields a patched file with no
// marker at all. Fall back to the entries' own replacement text, which is the same signal
// entryApplied() trusts.
function isOurs(src) {
  return src.includes(MARKER) || ENTRIES.some((e) => entryApplied(src, e));
}

// The untouched vendor file.
//
// A backup is NOT pristine-forever. That rule breaks the moment upstream rewrites the
// target IN PLACE: we would rebuild from a stale pristine and write it over the new file,
// silently reverting the update — and the monitor, re-applying on a timer, would keep
// doing it. A watchdog that quietly downgrades the thing it guards.
//
// npx cache dirs are versioned, so a new CLI release usually lands at a NEW path with no
// backup and re-baselines by luck. A GLOBAL install (`npm i -g @claude-flow/cli`) does
// not: it sits at a fixed path under GLOBAL_ROOTS and `npm update -g` overwrites it in
// place. Same hazard, and reproduced on the plugin patchers, which shared this rule.
//
// So: if what's on disk is neither our output nor the backup we hold, upstream (or a
// human) replaced it. Their bytes are the new truth — adopt them as pristine and re-derive
// the patches on top. If the new file no longer matches our anchors, `rebuild()` drops
// those entries with `skip:anchor-not-found` instead of pretending, which is the signal
// you want: upstream moved, come look.
function readPristine(file, result = null) {
  const backup = backupOf(file);
  const current = fs.readFileSync(file, 'utf8');

  if (fs.existsSync(backup)) {
    const saved = fs.readFileSync(backup, 'utf8');

    // AN EMPTY BACKUP IS NOT A PRISTINE FILE — it is a poisoned one, and it is lethal.
    // Guarding only the on-disk file (above) misses this entirely: with an empty `saved`,
    // a perfectly healthy `current` yields pristine='', no anchors match, and the
    // `!usable.length` branch writes that empty pristine straight over the real file.
    // Measured: a 3954-byte vendor file reduced to 0 by ONE monitor tick.
    if (saved.length === 0) {
      fs.rmSync(backup, { force: true });
      if (isOurs(current)) {
        // We hold a patched file and no usable pristine. There is no honest way to recover
        // the vendor original from here, so do not invent one — say so and leave it be.
        result?.log.push(`skip:poisoned-backup ${file} — the .rsp-backup was empty and has been discarded; the file is patched but its pristine is unrecoverable. Reinstall the package to reset.`);
        return null;
      }
      // `current` is clean vendor code — adopt it as the new pristine.
      fs.copyFileSync(file, backup);
      return current;
    }

    if (current !== saved && !isOurs(current)) {
      fs.writeFileSync(backup, current); // re-baseline: reality outranks our backup
      // Never silent — this means the vendor file changed under us, which is exactly when
      // a human should be looking at whether the anchors still hold.
      result?.log.push(`re-baselined ${path.basename(file)} — upstream replaced it; patching the NEW file`);
      return current;
    }
    return saved;
  }

  if (isOurs(current)) return null; // patched but no backup — refuse to guess
  fs.copyFileSync(file, backup);
  return current;
}

function applyEdits(src, entry) {
  for (const e of entry.edits) {
    src = e.all ? src.split(e.find).join(e.replace) : src.replace(e.find, e.replace);
  }
  return src;
}

// Rebuild ONE file to be exactly: pristine + the entries currently requested.
// How many times does this literal anchor occur? Applying is `split().join()` (replace-ALL) or
// `.replace()` (first only) — both are wrong when an anchor is ambiguous, in opposite ways.
function occurrences(src, needle) {
  let n = 0;
  let i = 0;
  while ((i = src.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

function rebuild(file, entries, result) {
  // NEVER touch an empty vendor file, and never treat one as pristine.
  //
  // This is not paranoia — it is a post-mortem. `npx` populates its cache by creating files
  // and then writing them, so a hook or monitor tick that lands mid-extraction can read a
  // target as ''. The old code took that empty string as the pristine source, found no
  // anchors in it, and then fell into the `!usable.length` branch below — which writes
  // `pristine` back to disk. That TRUNCATED the real vendor file to zero bytes and deleted
  // its backup. Found in the wild: daemon-autostart.js at 0 bytes in two npx caches, no
  // .rsp-backup, mtime matching a monitor tick — while the published tarball has 4553 bytes.
  //
  // A patcher that destroys the code it patches is worse than the bug it fixes. If the file
  // is empty, we do not know what it should contain: say so and leave it alone.
  const current = fs.readFileSync(file, 'utf8');
  if (current.length === 0) {
    result.log.push(`skip:empty-file ${file} — zero bytes (partial npx extract?); refusing to patch or overwrite it`);
    result.skipped++;
    return;
  }

  const pristine = readPristine(file, result);
  if (pristine === null) {
    result.log.push(`skip:patched-without-backup ${file}`);
    result.skipped++;
    return;
  }

  // Drop entries whose anchors no longer exist in this build, OR are no longer UNIQUE.
  //
  // AMBIGUITY IS NOT A LICENCE TO GUESS. An `all: true` edit means "every occurrence, deliberately"; any
  // other edit that matches MORE THAN ONCE means upstream duplicated or restructured the code we anchor
  // on, and we can no longer say WHERE this patch belongs. `.replace(find, …)` would silently take the
  // first one — which may not be the one that matters.
  //
  // Anchor uniqueness is a property of UPSTREAM'S code. We do not control it and cannot guarantee it for
  // any future release. Today all 17 anchors are unique — a measurement, not a promise. So we check it on
  // every apply, and refuse when it stops holding.
  const usable = entries.filter((e) => {
    const bad = e.edits.filter((ed) => {
      const n = occurrences(pristine, ed.find);
      // `all` is a property of the EDIT, not the entry — daemon/command-root deliberately marks two of
      // its three edits `all: true`, because `process.cwd()` legitimately appears at several call sites
      // and every one of them must be root-resolved. For those, ANY count >= 1 is correct and 0 is the
      // failure. For every other edit, exactly one occurrence or we do not know where it belongs.
      return ed.all ? n === 0 : n !== 1;
    });
    if (bad.length) {
      const dup = bad.find((ed) => occurrences(pristine, ed.find) > 1);
      result.log.push(dup
        ? `skip:ambiguous-anchor ${e.id} (${file}) — anchor occurs ${occurrences(pristine, dup.find)}x; upstream restructured, refusing to guess which one to patch`
        : `skip:anchor-not-found ${e.id} (${file})`);
      result.skipped++;
      return false;
    }
    return true;
  });

  if (!usable.length) {
    // Nothing applies -> the file must be pristine on disk.
    writeIfChanged(file, pristine);
    fs.rmSync(backupOf(file), { force: true });
    return;
  }

  const frags = usable.flatMap((e) => e.frags || []);
  let src = composePrelude(frags) + '\n' + pristine;
  for (const e of usable) src = applyEdits(src, e);

  if (!writeIfChanged(file, src)) {
    result.unchanged++;
    return; // already exactly right — the common case on a monitor tick
  }
  result.patched++;
  result.log.push(`patched ${path.basename(file)} <- ${usable.map((e) => e.id).join(', ')}`);
}

function restore(file, result) {
  const backup = backupOf(file);
  if (!fs.existsSync(backup)) return;

  // NEVER restore an EMPTY backup. This path bypasses every guard in readPristine() — it does
  // not need a pristine, it just copies the backup back — which makes a poisoned backup turn
  // UNINSTALL into the most destructive command in the tool: copyFileSync('', file) truncates
  // the very file it is supposed to be restoring. If we cannot restore anything, we destroy
  // nothing: drop the useless backup and leave the file alone. Patched beats empty.
  if (fs.statSync(backup).size === 0) {
    fs.rmSync(backup, { force: true });
    result.log.push(`skip:poisoned-backup ${file} — its .rsp-backup was empty; discarded rather than overwriting the file with nothing. Reinstall the package to reset.`);
    result.skipped++;
    return;
  }

  fs.copyFileSync(backup, file);
  fs.rmSync(backup, { force: true });
  result.restored++;
  result.log.push(`restored ${path.basename(file)}`);
}

/**
 * Make the installed library match EXACTLY the given set of targets.
 * Targets not listed are removed; listed ones are applied. Idempotent.
 */
export function apply(targets = []) {
  const desired = new Set(targets);
  // `errors` is counted, not merely logged. It used to be logged only — so a run where every
  // single file threw reported patched:0 skipped:0, which report() rendered as `nothing to do`
  // and every notification path filtered away. Counted, it reaches the summary and the exit code.
  const result = {
    patched: 0, restored: 0, skipped: 0, unchanged: 0, errors: 0, log: [],
  };

  // Group every discovered file with the entries that touch it.
  const byFile = new Map();
  for (const entry of ENTRIES) {
    for (const file of discover(entry.suffix)) {
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file).push(entry);
    }
  }

  for (const [file, entries] of byFile) {
    const active = entries.filter((e) => desired.has(e.target));
    try {
      if (active.length) rebuild(file, active, result);
      else restore(file, result);
    } catch (err) {
      result.errors++;
      result.log.push(`error ${file}: ${err.message}`);
    }
  }
  return result;
}

/** Which files each target currently touches on disk, and whether they're patched. */
export function inspect() {
  const out = {};
  for (const t of PATCH_TARGETS) out[t] = { files: 0, patched: 0 };
  for (const entry of ENTRIES) {
    for (const file of discover(entry.suffix)) {
      out[entry.target].files++;
      try {
        // Per-ENTRY, not per-file: a shared file carries one MARKER but may be missing
        // this entry's edits entirely.
        if (entryApplied(fs.readFileSync(file, 'utf8'), entry)) out[entry.target].patched++;
      } catch { /* unreadable */ }
    }
  }
  return out;
}
