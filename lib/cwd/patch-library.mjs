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
//   cwd     cwd anchoring (ruvnet/ruflo#2633). The stray folders are the SYMPTOM; the bug is silent
//           data loss: .claude-flow holds the learning state (autopilot/neural/metrics/agentdb/
//           memory.db), it is anchored to raw process.cwd(), and under an agent the cwd drifts and
//           STICKS. State is written where nothing will read it again, and loadState() returns
//           DEFAULTS rather than erroring. Anchors the resolver (ADR-0100 markers), the callees, and
//           the implicit-relative constants. See the FRAGMENTS + the `state/*` entries below.
//   daemon  legacy daemon command identity — current Ruflo is preserved and terminally retired only
//           after structural + executable proof that every direct route uses one project root (#2877).
//   memory  .swarm/memory.db durability above native #2878 — stronger fail-closed ownership,
//           fail-closed raw access while native WAL sidecars exist (#2735), an integrity gate that refuses a
//           whole-file flush over an already-torn image, and a stale-writer guard that
//           kills every pre-patch writer the in-file lock can never reach (daemon AND MCP
//           client) to force fresh code, loudly warning wherever a kill needs a manual
//           /mcp reconnect afterward (ADR-023).
//
// Idempotent, reversible (per-file `.rsp-backup` = the untouched vendor file), and
// safe-fail on version drift: an entry whose anchor no longer matches is skipped
// individually — never a partial write, and never blocks the other entries.

import fs from 'node:fs';
import path from 'node:path';
import { NPX_ROOT, GLOBAL_ROOTS, PATCH_MARKER } from './paths.mjs';
import { HOST_PLUGIN_FRAGMENT } from '../plugin-hosts/fragment.mjs';
import { HOST_DISCOVERY_FRAGMENT } from '../plugin-hosts/discovery-fragment.mjs';

const MARKER = PATCH_MARKER;

export const PATCH_TARGETS = ['cwd', 'daemon', 'memory', 'init', 'plugin-hosts'];

export const TARGET_INFO = {
  cwd: 'cwd anchoring — .claude-flow/.swarm and the DURABLE stores (autopilot/neural/metrics/agentdb) stop following a drifted cwd (#2633)',
  daemon: 'legacy daemon identity; retires on executable native project-root proof (#2877 / #2633)',
  memory: 'memory.db durability above native #2878 — stronger fail-closed lock ownership + WAL-sidecar refusal (#2735) + integrity gate + positively-resolved stale-writer recovery (ADR-023)',
  init: '`ruflo init` stops generating plugin duplicates. Legacy #2777 external skills imports are suppressed; current bounded materialization is left intact. The durable complement to `plugin-only` (#2640/#2685)',
  'plugin-hosts': 'dual-host marketplace reconciliation + automatic verified updates (#2854/#2870)',
};

// ─── Injected code fragments ─────────────────────────────────────────────────
// Composable and de-duplicated: several entries can land in ONE file, so each
// fragment is emitted at most once, after its deps. `req` is the shared base —
// without it, installing `memory` WITHOUT `cwd` would inject the lock (which uses
// __rufloReq) into a file that never declared it.

// Exported so the SUITE can execute the code we inject, not merely grep for it. The memory write lock
// was introduced for ruflo #2878 (clean 3.33.0: 12 acked, 2 on disk). Current Ruflo supplies a
// native baseline; the stronger local ownership/failure semantics remain and are executed by tests.
export const FRAGMENTS = {
  req: {
    deps: [],
    src: `import { createRequire as __rufloCreateRequire } from 'module';
const __rufloReq = __rufloCreateRequire(import.meta.url);`,
  },

  // Project root, by ADR-0100's marker priority (sparkling/ruflo bb9e56dec).
  //
  // `.git` ALONE IS NOT ENOUGH, which is what this used to use. A monorepo package, or any project
  // initialised inside a larger repo, has a `.claude/` of its own and no `.git` — so a bare `.git` walk
  // sails past it to the outer repo and pools every package's state into one store. The marker order is
  // the fork's, and each rung is there for a reason:
  //
  //   1. `.ruflo-project`      an explicit contract. If someone wrote it, they meant it.
  //   2. `CLAUDE.md` + `.claude/`, BOTH required. Either alone is a false positive: a `docs/CLAUDE.md`
  //      is not a project root, and a stray `.claude/` is not either.
  //   3. `.git`                the generic fallback.
  //   4. nothing found         return startDir — i.e. exactly the old behaviour. This can never be
  //                            worse than the raw cwd it replaces.
  //
  // Memoised per RESOLVED start dir, not once per process (ADR-0137). A module-level cache is the one
  // thing the fork's own ADR warns against: it goes stale precisely when the cwd drifts mid-session,
  // which is the case this whole patch exists for. Keying on the start dir means a drifted cwd is simply
  // a different key and re-walks, so a cached answer can never be the wrong one.
  resolveRoot: {
    deps: ['req'],
    src: `const __rufloRootCache = new Map();
function __rufloResolveRoot(startDir) {
  const start = startDir || process.cwd();
  const hit = __rufloRootCache.get(start);
  if (hit !== undefined) return hit;
  let out = start;
  try {
    const nfs = __rufloReq('fs'); const npath = __rufloReq('path');
    const has = (d, f) => nfs.existsSync(npath.join(d, f));
    let dir = npath.resolve(start);
    for (let i = 0; i < 32; i++) {
      if (has(dir, '.ruflo-project')) { out = dir; break; }
      if (has(dir, 'CLAUDE.md') && has(dir, '.claude')) { out = dir; break; }
      if (has(dir, '.git')) { out = dir; break; }
      const parent = npath.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch { /* fall through: out stays as the raw start dir */ }
  __rufloRootCache.set(start, out);
  return out;
}`,
  },

  // #2735 establishes the safe policy for a raw whole-image sql.js access while a
  // native better-sqlite3 WAL holder is live: REFUSE it. The former patch forced
  // wal_checkpoint(TRUNCATE) before every *.db read. That made this reader mutate
  // another connection's live database and could cement a mismatched WAL/main pair.
  // Presence, not WAL byte length, is the signal: a native connection may hold a
  // zero-byte WAL for its entire lifetime. Fail closed on sidecar stat errors too.
  walRefusal: {
    deps: ['req'],
    src: `function __rufloIsDb(p) {
  return typeof p === 'string' && /\\.db$/.test(p);
}
function __rufloWalRefusal(p, why) {
  const e = new Error('[ruflo-source-patch] REFUSING raw whole-image access to ' + p + ': ' + why + '. A sql.js read cannot see live WAL frames, and replacing the main file would detach or mispair another connection\\'s WAL. Nothing was read or written. Use the native AgentDB path, or close the native holder and retry; this patch will not checkpoint, unlink, or rename another connection\\'s sidecars.');
  e.code = 'RSP_UNSAFE_WAL_SIDECARS';
  throw e;
}
function __rufloRefuseWalSidecars(p) {
  if (!__rufloIsDb(p)) return;
  let nfs;
  try { nfs = __rufloReq('fs'); }
  catch { __rufloWalRefusal(p, 'the filesystem could not be inspected safely'); }
  for (const sidecar of [p + '-wal', p + '-shm']) {
    try {
      nfs.lstatSync(sidecar);
      __rufloWalRefusal(p, 'live SQLite sidecar exists: ' + sidecar);
    } catch (e) {
      if (e && e.code === 'RSP_UNSAFE_WAL_SIDECARS') throw e;
      if (e && e.code === 'ENOENT') continue;
      __rufloWalRefusal(p, 'could not prove sidecar absence for ' + sidecar);
    }
  }
}`,
  },

  // Cross-process single-writer lock for .swarm/memory.db — #2878, extracted
  // from the prematurely-closed #2621. Clean 3.33.0 still acknowledges writes
  // it loses (measured 12 acked, 2 on disk).
  //
  // storeEntry/getEntry/deleteEntry each do a whole-file read-modify-write, so two
  // processes can each read image v1 and each rename — the second clobbers the first.
  // Only mutual exclusion spanning read..write fixes it.
  //
  //  - ASYNC-CONTEXT REENTRANT: a truly nested helper may re-enter, while two unrelated
  //    Promise chains in one process still serialize. A process-global refcount did not.
  //  - FAILS CLOSED: path, filesystem and timeout failures throw before the mutator runs.
  //    An unavailable lock can never turn into an acknowledged unlocked write.
  //  - OWNER-SAFE RELEASE: a unique claim plus inode check means a late cleanup can
  //    never unlink another writer's successor lock. There is deliberately no automatic
  //    stale-lock stealing: unlink is not compare-and-delete, so guessing is unsafe.
  memLock: {
    deps: ['req'],
    src: `const { AsyncLocalStorage: __rufloAsyncLocalStorage } = __rufloReq('node:async_hooks');
const __rufloLockScope = new __rufloAsyncLocalStorage();
const __rufloActiveLocks = new Map();
function __rufloLockFailure(p, why) {
  const e = new Error('[ruflo-source-patch] REFUSING memory.db operation for ' + String(p) + ': cross-process write lock unavailable (' + why + '). The operation did not run; retry after the current writer exits or repair the lock path. Proceeding unlocked would acknowledge silent data loss (ruflo#2878).');
  e.code = 'RSP_MEMORY_LOCK_UNAVAILABLE';
  return e;
}
function __rufloLockOwned(h, nfs) {
  if (!h) return false;
  try {
    const fdStat = nfs.fstatSync(h.fd);
    const pathStat = nfs.lstatSync(h.lockFile);
    if (fdStat.dev !== pathStat.dev || fdStat.ino !== pathStat.ino) return false;
    const claim = JSON.parse(nfs.readFileSync(h.lockFile, 'utf8'));
    return claim && claim.token === h.token && claim.pid === process.pid;
  } catch { return false; }
}
async function __rufloLockAcquire(p) {
  if (!p || typeof p !== 'string') throw __rufloLockFailure(p, 'database path is unresolved');
  let nfs;
  try { nfs = __rufloReq('fs'); }
  catch { throw __rufloLockFailure(p, 'filesystem module is unavailable'); }
  const lockFile = p + '.rsp-lock';
  const token = process.pid + ':' + Date.now().toString(36) + ':' + Math.random().toString(36).slice(2);
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      const fd = nfs.openSync(lockFile, nfs.constants.O_CREAT | nfs.constants.O_EXCL | nfs.constants.O_WRONLY, 0o600);
      const h = { fd, lockFile, token };
      try {
        nfs.writeSync(fd, JSON.stringify({ pid: process.pid, token }));
        nfs.fsyncSync(fd);
      }
      catch (e) {
        try { if (__rufloLockOwned(h, nfs)) nfs.unlinkSync(lockFile); } catch {}
        try { nfs.closeSync(fd); } catch {}
        throw __rufloLockFailure(p, 'could not record lock ownership: ' + (e && e.message ? e.message : String(e)));
      }
      __rufloActiveLocks.set(p, h);
      return h;
    } catch (e) {
      if (e && e.code === 'RSP_MEMORY_LOCK_UNAVAILABLE') throw e;
      if (!e || e.code !== 'EEXIST')
        throw __rufloLockFailure(p, e && e.message ? e.message : String(e));
      if (Date.now() > deadline) throw __rufloLockFailure(p, 'timed out after 5s: ' + lockFile);
      await new Promise((r) => setTimeout(r, 15 + Math.floor(Math.random() * 25)));
    }
  }
}
function __rufloLockRelease(p, h) {
  if (!h) return;
  __rufloActiveLocks.delete(p);
  let nfs;
  try { nfs = __rufloReq('fs'); } catch { return; }
  const owned = __rufloLockOwned(h, nfs);
  try { if (owned) nfs.unlinkSync(h.lockFile); } catch {}
  try { nfs.closeSync(h.fd); } catch {}
}
async function __rufloWithLock(p, fn) {
  const held = __rufloLockScope.getStore();
  const inherited = held && held.get(p);
  if (inherited && __rufloActiveLocks.get(p) === inherited) return fn();
  const h = await __rufloLockAcquire(p);
  const next = new Map(held || []);
  next.set(p, h);
  return __rufloLockScope.run(next, async () => {
    try { return await fn(); }
    finally { __rufloLockRelease(p, h); }
  });
}
try {
  process.on('exit', () => {
    for (const [p, h] of [...__rufloActiveLocks]) __rufloLockRelease(p, h);
  });
} catch { /* no process hook available */ }`,
  },

  // Defensive integrity gate — ADR-023. The write lock stops two PATCHED, COOPERATING
  // writers from clobbering each other; atomic flush (upstream #2584) stops a reader
  // seeing a torn image. Neither covers the case that actually corrupted
  // semantic-product-mock: a whole-file flush landing on a database that is ALREADY
  // torn — from a pre-patch/unpatched writer, a crash mid-rename, or an older build.
  // sql.js opens a truncated image WITHOUT error, loses the missing pages, and the
  // mutator re-exports the shrunken image over the original: an acked write that has
  // silently destroyed the store. "no such table: memory_entries" on a multi-megabyte
  // file is the measured symptom. That is a failure wearing success's face, which is
  // the one thing this package exists to forbid. So: under the lock, before the flush,
  // verify the on-disk SQLite header is self-consistent, and REFUSE (throw) rather than
  // overwrite damage. Pure buffer read of <=100 bytes; no engine load, no second image.
  integrityGate: {
    deps: ['req'],
    src: `function __rufloIntegrityFail(p, why) {
  const e = new Error('[ruflo-source-patch] REFUSING whole-image write to ' + p + ': the existing database could not be proven safe (' + why + '). A raw rewrite could overwrite damage as if the store were empty and ACK the loss silently. Nothing was written; the file on disk is unchanged. Recover the database or repair access, then retry.');
  e.__rufloIntegrity = true;
  e.code = 'RSP_UNSAFE_DB_IMAGE';
  throw e;
}
function __rufloIntegrityCheck(p) {
  if (typeof p !== 'string' || !/\\.db$/.test(p)) return;
  let nfs;
  try { nfs = __rufloReq('fs'); }
  catch { __rufloIntegrityFail(p, 'filesystem module is unavailable'); }
  let size;
  try { size = nfs.statSync(p).size; }
  catch (e) {
    if (e && e.code === 'ENOENT') return; // no file yet: a legitimate first write
    __rufloIntegrityFail(p, 'could not inspect the existing file: ' + (e && e.message ? e.message : String(e)));
  }
  if (size === 0) return;                                  // fresh/empty: init owns this, not us
  try {
    if (size < 100) __rufloIntegrityFail(p, 'file is ' + size + ' bytes, smaller than a SQLite header');
    const fd = nfs.openSync(p, 'r');
    const hdr = Buffer.alloc(100);
    try { nfs.readSync(fd, hdr, 0, 100, 0); } finally { nfs.closeSync(fd); }
    if (hdr.toString('latin1', 0, 16) !== 'SQLite format 3\\u0000')
      __rufloIntegrityFail(p, 'SQLite magic header missing');
    let pageSize = hdr.readUInt16BE(16);
    if (pageSize === 1) pageSize = 65536;                  // the spec's 64KiB sentinel
    if (pageSize < 512 || (pageSize & (pageSize - 1)) !== 0)
      __rufloIntegrityFail(p, 'invalid page size ' + pageSize);
    const changeCounter = hdr.readUInt32BE(24);
    const pageCount = hdr.readUInt32BE(28);
    const versionValidFor = hdr.readUInt32BE(92);
    // The in-header page count (offset 28) is authoritative ONLY when the file change
    // counter (24) equals the version-valid-for number (92) — SQLite file-format spec.
    // When it is, page_size * page_count MUST equal the file size; a mismatch is a
    // truncated or torn image.
    if (pageCount > 0 && changeCounter === versionValidFor) {
      if (pageSize * pageCount !== size)
        __rufloIntegrityFail(p, 'header declares ' + pageCount + ' pages (' + (pageSize * pageCount) + ' bytes) but the file is ' + size + ' bytes — truncated or torn');
    } else if (size % pageSize !== 0) {
      // Weaker fallback when the in-header size is not authoritative: a COMPLETE SQLite
      // file is always a whole number of pages, so a fractional tail is a truncation.
      __rufloIntegrityFail(p, 'file size ' + size + ' is not a multiple of page size ' + pageSize + ' — truncated mid-page');
    }
  } catch (e) {
    if (e && e.__rufloIntegrity) throw e;  // our refusal — propagate it LOUD
    __rufloIntegrityFail(p, 'verification failed: ' + (e && e.message ? e.message : String(e)));
  }
}`,
  },

  hostPlugins: {
    deps: [],
    src: HOST_PLUGIN_FRAGMENT,
  },
  hostDiscovery: {
    deps: [],
    src: HOST_DISCOVERY_FRAGMENT,
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
      const raw = typeof v === 'string' && v
        ? v
        : v && typeof v === 'object' && typeof v.dbPath === 'string' && v.dbPath
          ? v.dbPath
          : undefined;
      return resolveDbPath(raw);
    } catch { return null; }
  };
  const __rufloGuard = (fn, before) => async function (arg) {
    const p = __rufloPathOf(arg);
    return __rufloWithLock(p, async () => {
      if (before) before(p, arg);
      return fn.call(this, arg);
    });
  };
  const __rufloReadGuard = (fn) => async function (arg) {
    __rufloRefuseWalSidecars(__rufloPathOf(arg));
    return fn.call(this, arg);
  };
  // Every exported whole-image writer shares one fail-closed lock. The integrity and
  // WAL gates live at fs-secure's actual read/write boundary, so a successful native
  // AgentDB bridge operation is not mistaken for a raw sql.js rewrite.
  initializeMemoryDatabase = __rufloGuard(initializeMemoryDatabase, (p, arg) => {
    if (arg && arg.force) __rufloRefuseWalSidecars(p); // before upstream unlinks the DB
  });
  storeEntry = __rufloGuard(storeEntry);
  getEntry = __rufloGuard(getEntry);
  deleteEntry = __rufloGuard(deleteEntry);
  applyTemporalDecay = __rufloGuard(applyTemporalDecay);
  ensureSchemaColumns = __rufloGuard(ensureSchemaColumns);
  // Native #2666 added purgeNamespace later. It must share the same cross-process lock as every
  // writer; its own <db>.lock only coordinates callers that opt into that different protocol.
  if (typeof purgeNamespace === 'function') purgeNamespace = __rufloGuard(purgeNamespace);
  // This status probe performs a raw sql.js image read and catches parse errors as a
  // normal "not initialized" result. Gate it outside that catch so a live WAL is a
  // loud refusal rather than a false healthy-looking status.
  checkMemoryInitialization = __rufloReadGuard(checkMemoryInitialization);
}
//# sourceMappingURL=memory-initializer.js.map`;

const hasEvery = (source, literals) => literals.every((literal) => source.includes(literal));

/**
 * Exact native replacement for cwd/daemon-autostart in Ruflo 3.38.11+.
 *
 * This is deliberately stronger than spotting the exported helper name: the helper must
 * feed every operation whose identity matters (config, project recognition, pid/alive
 * lookup, and spawn). Removing any route makes this false and puts the local patch back
 * in charge on the next mutating run.
 */
export function nativeDaemonAutostartSatisfied(source) {
  return hasEvery(source, [
    'export function resolveDaemonProjectRoot(startDir)',
    'const projectRoot = resolveDaemonProjectRoot(startDir);',
    'autostartDisabled(projectRoot)',
    'isRufloProject(projectRoot)',
    '(opts.isAlive ?? isDaemonAlive)(projectRoot)',
    '(opts.spawnFn ?? defaultSpawn)(projectRoot)',
  ]);
}

/** Exact native replacement for daemon/command-root in Ruflo 3.38.11+. */
export function nativeDaemonCommandSatisfied(source) {
  const routedCalls = source.split('resolveDaemonProjectRoot(process.cwd())').length - 1;
  const unsafeIdentity = [
    '?? process.cwd();',
    'const projectRoot = process.cwd();',
    'getDaemon(process.cwd()',
    'killBackgroundDaemon(process.cwd())',
  ];
  return source.includes("import { resolveDaemonProjectRoot } from '../services/daemon-autostart.js';")
    && source.includes('?? resolveDaemonProjectRoot(process.cwd());')
    && routedCalls >= 7
    && !unsafeIdentity.some((literal) => source.includes(literal));
}

// ─── Entries ─────────────────────────────────────────────────────────────────
// One entry = one coherent edit-set on one file, owned by exactly one target.
// Several entries may share a file (see memory-initializer): the rebuild composes them.

// Exported for the suite so it can execute every supported patch shape.
export const ENTRIES = [
  // ── target: cwd ────────────────────────────────────────────────────────────
  {
    id: 'cwd/daemon-autostart',
    target: 'cwd',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'services', 'daemon-autostart.js'],
    nativeSatisfied: nativeDaemonAutostartSatisfied,
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
  // The `daemon start|stop|status` COMMAND in legacy @claude-flow/cli. Direct daemon
  // commands skipped daemon-autostart, so the cwd target could not cover this path. The gap
  // remained live in clean 3.33.0: commands/daemon.js anchored .claude-flow/, daemon.pid,
  // and Ruflo's native #2407/#2484 lock to raw process.cwd(). Dedup is therefore keyed
  // per cwd, not per project. Measured on 3.33.0:
  //
  //   4 concurrent foreground starts from 4 project subdirs
  //     -> 4 live daemons and 4 subdirectory daemon.pid files
  //
  // Resolving to the project root makes that native lock/PID dedup bind across them and
  // makes status/stop from a subdir find the root daemon (#2877). The upstream lock is
  // retained byte-for-byte. Ruflo 3.38.11+ supplies the same routing natively; nativeSatisfied()
  // preserves those bytes, and lib/daemon/supersede.mjs executes and mutation-tests them before
  // terminal retirement.
  //
  // NOT patched on purpose: `const cwd = process.cwd();` — the "allow only paths within
  // project structure" guard is a security boundary, not state anchoring.
  {
    id: 'daemon/command-root',
    target: 'daemon',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'commands', 'daemon.js'],
    nativeSatisfied: nativeDaemonCommandSatisfied,
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
  // ── target: memory ─────────────────────────────────────────────────────────
  {
    id: 'memory/wal-sidecar-refusal',
    target: 'memory',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'fs-secure.js'],
    frags: ['walRefusal', 'integrityGate'],
    edits: [
      {
        find: "export function readFileMaybeEncrypted(path, encoding = 'utf-8') {\n    const raw = readFileSync(path);",
        replace: "export function readFileMaybeEncrypted(path, encoding = 'utf-8') {\n    __rufloRefuseWalSidecars(path);\n    const raw = readFileSync(path);",
      },
      {
        find: "export function writeFileAtomic(path, data, opts = {}) {\n    const mode = opts.mode ?? 0o600;",
        replace: "export function writeFileAtomic(path, data, opts = {}) {\n    __rufloRefuseWalSidecars(path);\n    __rufloIntegrityCheck(path);\n    const mode = opts.mode ?? 0o600;",
      },
    ],
  },
  {
    id: 'memory/write-lock',
    target: 'memory',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'memory', 'memory-initializer.js'],
    frags: ['memLock', 'walRefusal'],
    edits: [
      { find: '//# sourceMappingURL=memory-initializer.js.map', replace: LOCK_WRAP_SRC },
    ],
  },
  {
    id: 'state/commands-agent',
    target: 'cwd',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'commands', 'agent.js'],
    frags: ['resolveRoot'],
    edits: [
      // `.claude-flow` and `.swarm` are INDEPENDENT state dirs. A given upstream build may write
      // only one of them from this file (measured: neural.js at 4×.claude-flow / 0×.swarm in one
      // release, 5/10 in another). `optional` means "patch every occurrence, and ZERO is a valid
      // no-op — not a skip." The entry still requires AT LEAST ONE anchor present (see rebuild's
      // filter): a file we chose BECAUSE it writes state that now anchors NEITHER dir is real
      // drift, reported loudly. This is what stops one absent sibling from dropping the whole
      // entry and silently leaving the present sibling's call sites unpatched.
      { find: "process.cwd(), '.claude-flow'", replace: "__rufloResolveRoot(process.cwd()), '.claude-flow'", all: true, optional: true },
      { find: "process.cwd(), '.swarm'", replace: "__rufloResolveRoot(process.cwd()), '.swarm'", all: true, optional: true },
    ],
  },
  {
    id: 'state/commands-benchmark',
    target: 'cwd',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'commands', 'benchmark.js'],
    frags: ['resolveRoot'],
    edits: [
      { find: "process.cwd(), '.claude-flow'", replace: "__rufloResolveRoot(process.cwd()), '.claude-flow'", all: true },
    ],
  },
  {
    id: 'state/commands-embeddings',
    target: 'cwd',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'commands', 'embeddings.js'],
    frags: ['resolveRoot'],
    edits: [
      { find: "process.cwd(), '.claude-flow'", replace: "__rufloResolveRoot(process.cwd()), '.claude-flow'", all: true },
    ],
  },
  {
    id: 'state/commands-hooks',
    target: 'cwd',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'commands', 'hooks.js'],
    frags: ['resolveRoot'],
    edits: [
      // `.claude-flow` and `.swarm` are INDEPENDENT state dirs. A given upstream build may write
      // only one of them from this file (measured: neural.js at 4×.claude-flow / 0×.swarm in one
      // release, 5/10 in another). `optional` means "patch every occurrence, and ZERO is a valid
      // no-op — not a skip." The entry still requires AT LEAST ONE anchor present (see rebuild's
      // filter): a file we chose BECAUSE it writes state that now anchors NEITHER dir is real
      // drift, reported loudly. This is what stops one absent sibling from dropping the whole
      // entry and silently leaving the present sibling's call sites unpatched.
      { find: "process.cwd(), '.claude-flow'", replace: "__rufloResolveRoot(process.cwd()), '.claude-flow'", all: true, optional: true },
      { find: "process.cwd(), '.swarm'", replace: "__rufloResolveRoot(process.cwd()), '.swarm'", all: true, optional: true },
    ],
  },
  {
    id: 'state/commands-neural',
    target: 'cwd',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'commands', 'neural.js'],
    frags: ['resolveRoot'],
    edits: [
      // `.claude-flow` and `.swarm` are INDEPENDENT state dirs. A given upstream build may write
      // only one of them from this file (measured: neural.js at 4×.claude-flow / 0×.swarm in one
      // release, 5/10 in another). `optional` means "patch every occurrence, and ZERO is a valid
      // no-op — not a skip." The entry still requires AT LEAST ONE anchor present (see rebuild's
      // filter): a file we chose BECAUSE it writes state that now anchors NEITHER dir is real
      // drift, reported loudly. This is what stops one absent sibling from dropping the whole
      // entry and silently leaving the present sibling's call sites unpatched.
      { find: "process.cwd(), '.claude-flow'", replace: "__rufloResolveRoot(process.cwd()), '.claude-flow'", all: true, optional: true },
      { find: "process.cwd(), '.swarm'", replace: "__rufloResolveRoot(process.cwd()), '.swarm'", all: true, optional: true },
      {
        find: "        const outDir = path.resolve(process.cwd(), (ctx.flags['out-dir'] ?? ctx.flags.outDir) || '.claude-flow/neural/weft-export');",
        replace: "        const requestedOutDir = ctx.flags['out-dir'] ?? ctx.flags.outDir;\n        const outDir = path.resolve(requestedOutDir ? process.cwd() : __rufloResolveRoot(process.cwd()), requestedOutDir || '.claude-flow/neural/weft-export');",
        optional: true,
      },
      {
        find: "ctx.flags.sft || path.resolve(process.cwd(), '.claude-flow/neural/weft-export/sft.jsonl')",
        replace: "ctx.flags.sft || path.resolve(__rufloResolveRoot(process.cwd()), '.claude-flow/neural/weft-export/sft.jsonl')",
        all: true,
        optional: true,
      },
      {
        find: "ctx.flags.dpo || path.resolve(process.cwd(), '.claude-flow/neural/weft-export/dpo.jsonl')",
        replace: "ctx.flags.dpo || path.resolve(__rufloResolveRoot(process.cwd()), '.claude-flow/neural/weft-export/dpo.jsonl')",
        all: true,
        optional: true,
      },
    ],
  },
  {
    id: 'state/commands-security',
    target: 'cwd',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'commands', 'security.js'],
    frags: ['resolveRoot'],
    edits: [
      { find: "process.cwd(), '.swarm'", replace: "__rufloResolveRoot(process.cwd()), '.swarm'", all: true },
    ],
  },
  {
    id: 'state/commands-swarm',
    target: 'cwd',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'commands', 'swarm.js'],
    frags: ['resolveRoot'],
    edits: [
      { find: "process.cwd(), '.swarm'", replace: "__rufloResolveRoot(process.cwd()), '.swarm'", all: true },
      { find: "process.cwd(), '.claude-flow'", replace: "__rufloResolveRoot(process.cwd()), '.claude-flow'", all: true, optional: true },
    ],
  },
  {
    id: 'state/permission-audit',
    target: 'cwd',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'permission', 'permission-audit.js'],
    frags: ['resolveRoot'],
    edits: [
      {
        find: "swarmDir ?? path.join(process.cwd(), '.swarm')",
        replace: "swarmDir ?? path.join(__rufloResolveRoot(process.cwd()), '.swarm')",
        all: true,
      },
    ],
  },
  {
    id: 'state/init-helpers-generator',
    target: 'cwd',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'init', 'helpers-generator.js'],
    frags: ['resolveRoot'],
    edits: [
      {
        find: "const SESSION_DIR = path.join(process.cwd(), '.claude-flow', 'sessions');",
        replace: "const SESSION_DIR = path.join(path.resolve(__dirname, '..', '..'), '.claude-flow', 'sessions');",
        all: true,
      },
      {
        find: "const MEMORY_DIR = path.join(process.cwd(), '.claude-flow', 'data');",
        replace: "const MEMORY_DIR = path.join(path.resolve(__dirname, '..', '..'), '.claude-flow', 'data');",
      },
      {
        find: "  const localDir = path.join(process.cwd(), '.claude-flow', 'sessions');",
        replace: "  const localDir = path.join(path.resolve(__dirname, '..', '..'), '.claude-flow', 'sessions');",
      },
    ],
  },
  {
    id: 'state/mcp-server',
    target: 'cwd',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'mcp-server.js'],
    frags: ['resolveRoot'],
    edits: [
      { find: "process.cwd(), '.claude-flow'", replace: "__rufloResolveRoot(process.cwd()), '.claude-flow'", all: true },
    ],
  },
  {
    id: 'state/mcp-tools-hooks-tools-root',
    target: 'cwd',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'mcp-tools', 'hooks-tools.js'],
    frags: ['resolveRoot'],
    edits: [
      { find: "process.cwd(), '.swarm'", replace: "__rufloResolveRoot(process.cwd()), '.swarm'", all: true },
      {
        find: "const insightsPath = resolve(join('.claude-flow', 'data', 'pending-insights.jsonl'));",
        replace: "const insightsPath = resolve(join(__rufloResolveRoot(getProjectCwd()), '.claude-flow', 'data', 'pending-insights.jsonl'));",
        optional: true,
      },
    ],
  },
  {
    id: 'state/mcp-tools-hooks-tools-session-legacy',
    target: 'cwd',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'mcp-tools', 'hooks-tools.js'],
    appliesWhen: 'duration: 3600000, // 1 hour in ms',
    frags: ['resolveRoot'],
    edits: [
      {
        find: [
          '        return {',
          '            sessionId,',
          '            duration: 3600000, // 1 hour in ms',
          "            statePath: saveState ? `.claude/sessions/${sessionId}.json` : undefined,",
          '            daemon: { stopped: daemonStopped },',
          "            sessionPersistence: sessionPersistence || { controller: 'none', persisted: false },",
          '            summary: {',
          '                tasksExecuted: taskCount,',
          '                filesModified: 0,',
          '                agentsSpawned: agentCount,',
          '                pendingInsights: insightCount,',
          '                memoryEntries: allEntries.length,',
          '            },',
          '            learningUpdates: {',
          '                patternsLearned: patternCount,',
          '                trajectoriesRecorded: trajectoryCount,',
          '            },',
          '        };',
        ].join('\n'),
        replace: [
          '        const summary = {',
          '            tasksExecuted: taskCount,',
          '            filesModified: 0,',
          '            agentsSpawned: agentCount,',
          '            pendingInsights: insightCount,',
          '            memoryEntries: allEntries.length,',
          '        };',
          '        const learningUpdates = {',
          '            patternsLearned: patternCount,',
          '            trajectoriesRecorded: trajectoryCount,',
          '        };',
          '        const snapshot = {',
          '            sessionId,',
          '            duration: 3600000, // 1 hour in ms',
          '            daemon: { stopped: daemonStopped },',
          "            sessionPersistence: sessionPersistence || { controller: 'none', persisted: false },",
          '            summary,',
          '            learningUpdates,',
          '        };',
          '        let statePath;',
          '        if (saveState) {',
          "            const stateDir = join(__rufloResolveRoot(getProjectCwd()), '.claude', 'sessions');",
          '            mkdirSync(stateDir, { recursive: true });',
          "            statePath = join(stateDir, sessionId + '.json');",
          "            const tempPath = statePath + '.tmp-' + process.pid;",
          "            writeFileSync(tempPath, JSON.stringify({ ...snapshot, savedAt: new Date().toISOString() }, null, 2), 'utf-8');",
          '            nodeFs.renameSync(tempPath, statePath);',
          '        }',
          '        return { ...snapshot, statePath };',
        ].join('\n'),
      },
    ],
  },
  {
    id: 'state/mcp-tools-hooks-tools-session-activity',
    target: 'cwd',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'mcp-tools', 'hooks-tools.js'],
    appliesWhen: 'const activity = loadSessionActivity(session, endedAt);',
    frags: ['resolveRoot'],
    edits: [
      {
        find: [
          '        return {',
          '            sessionId,',
          '            duration,',
          "            statePath: saveState ? `.claude/sessions/${sessionId}.json` : undefined,",
          '            daemon: { stopped: daemonStopped },',
          "            sessionPersistence: sessionPersistence || { controller: 'none', persisted: false },",
          '            summary: {',
          '                tasksExecuted: activity.tasksCompleted,',
          '                filesModified: activity.editsRecorded,',
          '                agentsSpawned: agentCount,',
          '                pendingInsights: insightCount,',
          '                memoryEntries: allEntries.length,',
          '            },',
          '            learningUpdates: {',
          '                patternsLearned: activity.patternsLearned,',
          '                trajectoriesRecorded: trajectoryCount,',
          '            },',
          '        };',
        ].join('\n'),
        replace: [
          '        const sessionSummary = {',
          '            tasksExecuted: activity.tasksCompleted,',
          '            filesModified: activity.editsRecorded,',
          '            agentsSpawned: agentCount,',
          '            pendingInsights: insightCount,',
          '            memoryEntries: allEntries.length,',
          '        };',
          '        const learningUpdates = {',
          '            patternsLearned: activity.patternsLearned,',
          '            trajectoriesRecorded: trajectoryCount,',
          '        };',
          '        const snapshot = {',
          '            sessionId,',
          '            duration,',
          '            daemon: { stopped: daemonStopped },',
          "            sessionPersistence: sessionPersistence || { controller: 'none', persisted: false },",
          '            summary: sessionSummary,',
          '            learningUpdates,',
          '        };',
          '        let statePath;',
          '        if (saveState) {',
          "            const stateDir = join(__rufloResolveRoot(getProjectCwd()), '.claude', 'sessions');",
          '            mkdirSync(stateDir, { recursive: true });',
          "            statePath = join(stateDir, sessionId + '.json');",
          "            const tempPath = statePath + '.tmp-' + process.pid;",
          "            writeFileSync(tempPath, JSON.stringify({ ...snapshot, savedAt: new Date().toISOString() }, null, 2), 'utf-8');",
          '            nodeFs.renameSync(tempPath, statePath);',
          '        }',
          '        return { ...snapshot, statePath };',
        ].join('\n'),
      },
    ],
  },
  {
    id: 'state/memory-ewc-consolidation',
    target: 'cwd',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'memory', 'ewc-consolidation.js'],
    frags: ['resolveRoot'],
    edits: [
      { find: "process.cwd(), '.swarm'", replace: "__rufloResolveRoot(process.cwd()), '.swarm'", all: true },
    ],
  },
  {
    id: 'state/memory-memory-bridge',
    target: 'cwd',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'memory', 'memory-bridge.js'],
    frags: ['resolveRoot'],
    edits: [
      { find: "process.cwd(), '.swarm'", replace: "__rufloResolveRoot(process.cwd()), '.swarm'", all: true },
    ],
  },
  {
    id: 'state/memory-rabitq-index',
    target: 'cwd',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'memory', 'rabitq-index.js'],
    frags: ['resolveRoot'],
    edits: [
      { find: "process.cwd(), '.swarm'", replace: "__rufloResolveRoot(process.cwd()), '.swarm'", all: true },
    ],
  },
  {
    id: 'state/ruvector-graph-backend',
    target: 'cwd',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'ruvector', 'graph-backend.js'],
    frags: ['resolveRoot'],
    edits: [
      { find: "process.cwd(), '.claude-flow'", replace: "__rufloResolveRoot(process.cwd()), '.claude-flow'", all: true },
    ],
  },
  {
    id: 'state/ruvector-lora-adapter',
    target: 'cwd',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'ruvector', 'lora-adapter.js'],
    frags: ['resolveRoot'],
    edits: [
      // `.claude-flow` and `.swarm` are INDEPENDENT state dirs. A given upstream build may write
      // only one of them from this file (measured: neural.js at 4×.claude-flow / 0×.swarm in one
      // release, 5/10 in another). `optional` means "patch every occurrence, and ZERO is a valid
      // no-op — not a skip." The entry still requires AT LEAST ONE anchor present (see rebuild's
      // filter): a file we chose BECAUSE it writes state that now anchors NEITHER dir is real
      // drift, reported loudly. This is what stops one absent sibling from dropping the whole
      // entry and silently leaving the present sibling's call sites unpatched.
      { find: "process.cwd(), '.claude-flow'", replace: "__rufloResolveRoot(process.cwd()), '.claude-flow'", all: true, optional: true },
      { find: "process.cwd(), '.swarm'", replace: "__rufloResolveRoot(process.cwd()), '.swarm'", all: true, optional: true },
    ],
  },
  {
    id: 'state/ruvector-router-trajectory',
    target: 'cwd',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'ruvector', 'router-trajectory.js'],
    frags: ['resolveRoot'],
    edits: [
      { find: "process.cwd(), '.swarm'", replace: "__rufloResolveRoot(process.cwd()), '.swarm'", all: true },
    ],
  },
  {
    id: 'state/ruvector-run-transcript-recorder',
    target: 'cwd',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'ruvector', 'run-transcript-recorder.js'],
    frags: ['resolveRoot'],
    edits: [
      { find: "process.cwd(), '.swarm'", replace: "__rufloResolveRoot(process.cwd()), '.swarm'", all: true },
    ],
  },

  // THE TWO THAT NO SEARCH FOR `cwd` CAN FIND, and the reason the fork wired a write-path GUARD rather
  // than trusting a grep. A one-arg `resolve()` is ALREADY relative to process.cwd(), so these paths are
  // cwd-anchored without the word appearing anywhere:
  //
  //     export const STATE_DIR = '.claude-flow/data';
  //     const dir = resolve(STATE_DIR);            <- relative to cwd. No `process.cwd()` token.
  //
  // autopilot is also the clearest case of the silent-amnesia harm: loadState() does not error when the
  // file is not at the drifted cwd — it RETURNS DEFAULTS, and saveState() then writes a fresh one there.
  // The iteration count and history reset, and nothing anywhere says so.
  //
  // Patching the CONSTANT fixes all five call sites in one edit: STATE_FILE and LOG_FILE are template
  // literals derived from STATE_DIR, and `resolve(<absolute>)` returns it unchanged.
  {
    id: 'state/autopilot',
    target: 'cwd',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'autopilot-state.js'],
    frags: ['resolveRoot'],
    edits: [
      {
        find: "export const STATE_DIR = '.claude-flow/data';",
        replace: "export const STATE_DIR = __rufloResolveRoot(process.cwd()) + '/.claude-flow/data';",
      },
      {
        find: "const swarmFile = resolve('.claude-flow/swarm-tasks.json');",
        replace: "const swarmFile = resolve(__rufloResolveRoot(process.cwd()), '.claude-flow/swarm-tasks.json');",
      },
      {
        find: "const checklistFile = resolve('.claude-flow/data/checklist.json');",
        replace: "const checklistFile = resolve(__rufloResolveRoot(process.cwd()), '.claude-flow/data/checklist.json');",
      },
    ],
  },
  {
    id: 'state/claims',
    target: 'cwd',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'commands', 'claims.js'],
    frags: ['resolveRoot'],
    edits: [
      {
        find: "path.resolve('.claude-flow/claims.json'),",
        replace: "path.resolve(__rufloResolveRoot(process.cwd()), '.claude-flow/claims.json'),",
      },
    ],
  },

  // ─── THE THIRD FORM: cwd passed as an ARGUMENT ───────────────────────────────
  //
  // The literal edits above catch `path.join(process.cwd(), '.claude-flow', …)`. They cannot catch this:
  //
  //     index.js:150    const ap = applyChampion(process.cwd());
  //     applier.js:36   const cfDir = path.join(cwd, '.claude-flow');     <- no `process.cwd()` token
  //
  // 87 sites hand `process.cwd()` to a function that builds the path. A grep for the anchor finds none of
  // them, which is exactly why the fork wired a write-path GUARD instead of trusting a search.
  //
  // AND A PARTIAL FIX HERE IS WORSE THAN NONE. We shipped one: `cwd/cli-core-getProjectCwd` anchored the
  // READER of `.claude-flow/harness-active-policy.json` (neural-tools.js:53, via getProjectCwd) while its
  // WRITER (index.js -> applyChampion) still used the drifted cwd. Unpatched, both sides agreed on the
  // drifted directory — sprawl, but coherent. Patched, the reader looked at the project root for a file
  // the writer had put somewhere else, and silently found nothing. We turned a visible mess into an
  // invisible one, which is the precise failure this package exists to prevent.
  //
  // Anchor INSIDE THE CALLEE, not at the 87 call sites: one edit fixes every caller, present and future.
  // `services/daemon-autostart.js` already does exactly this (`projectRoot = __rufloResolveRoot(...)` as
  // its first statement), so this is the established shape, not a new one.
  //
  // `commands/init.js` is deliberately NOT in this list. `init` legitimately targets the invocation
  // directory — resolving it would initialise a nested project at the outer repo root. That is the fork's
  // `adr-0100-allow: intentional-cwd` triage, and it is the reason a blanket chdir cannot work either.
  {
    id: 'state/harness-applier',
    target: 'cwd',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'config', 'harness-feedback-applier.js'],
    frags: ['resolveRoot'],
    edits: [
      {
        find: 'export function applyChampion(cwd, opts = {}) {',
        replace: 'export function applyChampion(cwd, opts = {}) {\n    cwd = __rufloResolveRoot(cwd);',
      },
      {
        find: 'export function applyChampionParams(cwd, opts) {',
        replace: 'export function applyChampionParams(cwd, opts) {\n    cwd = __rufloResolveRoot(cwd);',
      },
      {
        find: 'export function rollbackActivePolicy(cwd, opts = {}) {',
        replace: 'export function rollbackActivePolicy(cwd, opts = {}) {\n    cwd = __rufloResolveRoot(cwd);',
      },
    ],
  },
  {
    id: 'state/neural-datadir',
    target: 'cwd',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'memory', 'intelligence.js'],
    frags: ['resolveRoot'],
    edits: [
      {
        find: 'function getDataDir() {\n    const cwd = process.cwd();',
        replace: 'function getDataDir() {\n    const cwd = __rufloResolveRoot(process.cwd());',
      },
    ],
  },
  {
    id: 'state/distill-tuning',
    target: 'cwd',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'services', 'distill-tuning.js'],
    frags: ['resolveRoot'],
    edits: [
      {
        find: 'export function defaultTunedConfigPath(cwd = process.cwd()) {',
        replace: 'export function defaultTunedConfigPath(cwd = process.cwd()) {\n    cwd = __rufloResolveRoot(cwd);',
      },
    ],
  },
  {
    id: 'state/memory-backup',
    target: 'cwd',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'services', 'memory-backup.js'],
    frags: ['resolveRoot'],
    edits: [
      {
        find: 'export function defaultMemoryDbPath(cwd = process.cwd()) {',
        replace: 'export function defaultMemoryDbPath(cwd = process.cwd()) {\n    cwd = __rufloResolveRoot(cwd);',
      },
    ],
  },
  {
    id: 'state/memory-distillation',
    target: 'cwd',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'services', 'memory-distillation.js'],
    frags: ['resolveRoot'],
    edits: [
      {
        find: 'export function defaultMemoryDbPath(cwd = process.cwd()) {',
        replace: 'export function defaultMemoryDbPath(cwd = process.cwd()) {\n    cwd = __rufloResolveRoot(cwd);',
      },
    ],
  },
  {
    id: 'state/claim-service',
    target: 'cwd',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'services', 'claim-service.js'],
    frags: ['resolveRoot'],
    edits: [
      {
        find: 'export function createClaimService(projectRoot, config) {',
        replace: 'export function createClaimService(projectRoot, config) {\n    projectRoot = __rufloResolveRoot(projectRoot);',
      },
    ],
  },
  {
    id: 'state/harness-worker',
    target: 'cwd',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'services', 'harness-worker.js'],
    frags: ['resolveRoot'],
    edits: [
      {
        find: 'export async function runHarnessLoopWorker(projectRoot, opts = {}) {',
        replace: 'export async function runHarnessLoopWorker(projectRoot, opts = {}) {\n    projectRoot = __rufloResolveRoot(projectRoot);',
      },
    ],
  },
  {
    id: 'state/worker-daemon',
    target: 'cwd',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'services', 'worker-daemon.js'],
    frags: ['resolveRoot'],
    edits: [
      {
        find: 'export function getDaemon(projectRoot, config) {',
        replace: 'export function getDaemon(projectRoot, config) {\n    projectRoot = __rufloResolveRoot(projectRoot);',
      },
      {
        find: 'export async function startDaemon(projectRoot, config) {',
        replace: 'export async function startDaemon(projectRoot, config) {\n    projectRoot = __rufloResolveRoot(projectRoot);',
      },
    ],
  },

  // ── target: init ─────────────────────────────────────────────────────────────
  // `ruflo init` regenerates exactly what `plugin-only` removes, so an init/doctor run
  // silently re-adds it. This is the DURABLE complement: stop init from GENERATING the
  // plugin-duplicated artifacts in the first place. Three files, one target.
  //
  // (1) mcp-generator.js — the standalone `claude-flow` .mcp.json server. `mcp.claudeFlow`
  //     is hardcoded `true` in every init preset and no flag flips it; the CLI has NO
  //     notion of plugin-on vs plugin-off. On a plugin-always deployment that registration
  //     is a pure duplicate: a second writer on .swarm/memory.db (#2621), whose bare
  //     `mcp__claude-flow__*` tools don't resolve under plugin loading anyway (#2685). The
  //     guard `if (config.claudeFlow) {` occurs 3x (config + two add-command branches), so
  //     the anchor pins the config emission via the unique `createMCPServerEntry` line.
  {
    id: 'init/no-standalone-mcp',
    target: 'init',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'init', 'mcp-generator.js'],
    edits: [
      {
        find: "    if (config.claudeFlow) {\n        mcpServers['claude-flow'] = createMCPServerEntry(['ruflo@latest', 'mcp', 'start'], {",
        replace: "    if (false && config.claudeFlow) { // ruflo-source-patch(init): the ruflo plugin already provides this server; a project-local standalone copy double-writes .swarm/memory.db (#2621) and its bare tool refs don't resolve under plugin loading (#2685)\n        mcpServers['claude-flow'] = createMCPServerEntry(['ruflo@latest', 'mcp', 'start'], {",
      },
    ],
  },
  // (2) executor.js — the .claude/{skills,commands,agents} BUNDLE. Every init preset writes
  //     it (skills/commands/agents: true), and ~97-100% of it duplicates the installed
  //     plugins (#2640). Disable the three copy gates at the callee, so no preset writes the
  //     bundle. HELPERS ARE KEPT (init writes all ~43; no plugin replaces them), exactly as
  //     `plugin-only` keeps them. `settings`/`statusline`/`runtime`/`claudeMd`/`mcp` untouched.
  {
    id: 'init/no-bundle',
    target: 'init',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'init', 'executor.js'],
    edits: [
      {
        find: '        if (options.components.skills) {\n            await copySkills(targetDir, options, result);',
        replace: '        if (false && options.components.skills) { // ruflo-source-patch(init): the installed plugins provide the skills bundle (#2640)\n            await copySkills(targetDir, options, result);',
      },
      {
        find: '        if (options.components.commands) {\n            await copyCommands(targetDir, options, result);',
        replace: '        if (false && options.components.commands) { // ruflo-source-patch(init): the installed plugins provide the commands bundle (#2640)\n            await copyCommands(targetDir, options, result);',
      },
      {
        find: '        if (options.components.agents) {\n            await copyAgents(targetDir, options, result);',
        replace: '        if (false && options.components.agents) { // ruflo-source-patch(init): the installed plugins provide the agents bundle (#2640)\n            await copyAgents(targetDir, options, result);',
      },
    ],
  },
  // (3) commands/init.js — the skills.sh REGISTRATION. `maybeInstallSkillsSh()` runs
  //     `npx skills add ruvnet/ruflo --skill ruflo --yes` to register, in upstream's words,
  //     "the *single* canonical ruflo skill". What it actually lands is the ENTIRE ruvnet/ruflo
  //     repository under .agents/skills/ruflo/ — Cargo.toml, crates/, docs/, agentdb.rvf.
  //     Measured on a fresh scaffold: 97MB and 384 SKILL.md files, against the 4 real codex
  //     skills at 8K each. Upstream's own comment concedes it "clones the whole ruvnet/ruflo
  //     repo (~50MB)".
  //
  //     Same category as (1) and (2), which is why it belongs to `init`: the installed plugins
  //     already carry these skills, so the whole-repository import is duplication.
  //
  //     DELETING the import is not a fix — upstream's idempotency gate keys on
  //     .agents/skills/ruflo EXISTING, so the next `init` re-clones it. The behaviour has to be
  //     stopped at the source, which is what this package is for.
  //
  //     Upstream #2777 is fixed in 3.32.10+: current builds materialize one bounded SKILL.md
  //     directly. Keep this compatibility edit only for older builds that still execute the
  //     external `npx skills add` call; the upstream replacement must run untouched.
  {
    id: 'init/no-skills-sh',
    target: 'init',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'commands', 'init.js'],
    // Builds before skills.sh integration never had this behavior. Absence of the
    // feature is not anchor drift; once the function exists, the exact edit below
    // remains mandatory and a moved anchor still fails loudly.
    appliesWhen: "spawnSync(npxCmd, ['--yes', 'skills', 'add', 'ruvnet/ruflo', '--skill', 'ruflo', '--yes']",
    edits: [
      {
        find: "        if (ctx.flags['no-skills-sh'] === true)\n            return;",
        replace: "        if (true) // ruflo-source-patch(init): `skills add ruvnet/ruflo --skill ruflo` lands the WHOLE repo in .agents/skills/ruflo (97MB, 384 SKILL.md vs 4 real skills); also an unpinned npx fetch-and-execute of an undeclared dep (#2777)\n            return;\n        if (ctx.flags['no-skills-sh'] === true)\n            return;",
      },
    ],
  },

  // ── target: plugin-hosts ───────────────────────────────────────────────────
  // Claude Code and Codex deliberately keep separate plugin registries. Ruflo's
  // documented `/plugin install` path updates Claude only, while Codex init installs
  // only ruflo-core (#2801). Add explicit host-native commands to Ruflo's existing
  // plugin CLI; do not rewrite either host's cache or overload the IPFS/npm installer. #2870's
  // three collided identities also get a bounded remove/add refresh through those same public CLIs.
  {
    id: 'plugin-hosts/commands',
    target: 'plugin-hosts',
    suffix: ['@claude-flow', 'cli', 'dist', 'src', 'commands', 'plugins.js'],
    frags: ['hostPlugins'],
    proof: 'const __RSP_HOST_PLUGIN_REVISION = "2026-08-17.6";',
    edits: [
      {
        find: '    subcommands: [listCommand, searchCommand, installCommand, uninstallCommand, upgradeCommand, toggleCommand, infoCommand, createCommand, rateCommand],',
        replace: '    subcommands: [listCommand, searchCommand, installCommand, uninstallCommand, upgradeCommand, toggleCommand, infoCommand, createCommand, rateCommand, __rspHostInstallCommand, __rspHostUninstallCommand, __rspHostSyncCommand, __rspHostRefreshCommand, __rspHostUpdateCommand],',
      },
      {
        find: "            `${output.highlight('create')}    - Scaffold a new plugin project`,",
        replace: "            `${output.highlight('create')}    - Scaffold a new plugin project`,\n            `${output.highlight('host-install')}   - Install a Ruflo marketplace plugin in Claude Code + Codex`,\n            `${output.highlight('host-uninstall')} - Uninstall a user-scoped Ruflo plugin from both hosts`,\n            `${output.highlight('host-sync')}      - Add enabled Claude Ruflo plugins missing from Codex`,\n            `${output.highlight('host-refresh')}   - Refresh an audited same-version marketplace collision`,\n            `${output.highlight('host-update')}    - Update all installed Ruflo plugins in both hosts`,",
      },
    ],
  },
  {
    id: 'plugin-hosts/codex-initializer',
    target: 'plugin-hosts',
    suffix: [
      '@claude-flow', 'cli', 'node_modules', '@claude-flow', 'codex',
      'dist', 'initializer.js',
    ],
    frags: ['hostDiscovery'],
    proof: 'const __RSP_HOST_DISCOVERY_REVISION = "2026-08-17.3";',
    edits: [
      {
        find: "import { getRufloMcpAddCommand } from './mcp-config.js';",
        replace: "import { getRufloMcpAddCommand, getRufloMcpServerConfig } from './mcp-config.js';",
      },
      {
        find: "                execSync('which codex', { stdio: 'pipe' });",
        replace: "                await __rspResolveHostExecutable('codex');",
        all: true,
      },
      {
        find: "                const listJson = execSync('codex mcp list --json 2>&1', { encoding: 'utf-8' });",
        replace: "                const listJson = await __rspHostExec('codex', ['mcp', 'list', '--json']);",
      },
      {
        find: "                    const list = execSync('codex mcp list 2>&1', { encoding: 'utf-8' });",
        replace: "                    const list = await __rspHostExec('codex', ['mcp', 'list']);",
      },
      {
        find: "                execSync(getRufloMcpAddCommand(), {\n                    stdio: 'pipe',\n                    timeout: 10000,\n                });",
        replace: "                const server = getRufloMcpServerConfig();\n                await __rspHostExec('codex', ['mcp', 'add', 'ruflo', '--', server.command, ...(server.args ?? [])]);",
      },
      {
        find: "                const listJson = execSync('codex plugin list --json 2>&1', { encoding: 'utf-8' });",
        replace: "                const listJson = await __rspHostExec('codex', ['plugin', 'list', '--json']);",
      },
      {
        find: "                    const list = execSync('codex plugin list 2>&1', { encoding: 'utf-8' });",
        replace: "                    const list = await __rspHostExec('codex', ['plugin', 'list']);",
      },
      {
        find: "                execSync('codex plugin marketplace add ruvnet/ruflo --ref main', { stdio: 'pipe', timeout: 20000 });",
        replace: "                await __rspHostExec('codex', ['plugin', 'marketplace', 'add', 'ruvnet/ruflo', '--ref', 'main']);",
      },
      {
        find: "                execSync('codex plugin add ruflo-core@ruflo', { stdio: 'pipe', timeout: 20000 });",
        replace: "                await __rspHostExec('codex', ['plugin', 'add', 'ruflo-core@ruflo']);",
      },
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
  for (const g of GLOBAL_ROOTS) {
    dirs.push(g); // direct `npm install -g @claude-flow/cli`
    // The public `ruflo` package is a thin global wrapper whose real CLI is a
    // dependency, so npm nests it one node_modules deeper. Without this candidate
    // a global `npm install -g ruflo` is silently outside the monitor's coverage.
    dirs.push(path.join(g, 'ruflo', 'node_modules'));
  }
  return [...new Set(dirs)];
}

// npm/npx installs a SECOND, full copy of a package under a content-addressed "hidden" alias dir
// (`@claude-flow/.cli-YaBvWJZO`, `@claude-flow/.cli-core-wzeVoLs2`) whenever more than one version
// must coexist in one tree. It is a complete package — same `commands/daemon.js`, same anchors — and
// a literal `@scope/pkg` suffix join never finds it, so it ships UNPATCHED and, worse, silently: the
// daemon it can spawn is exactly the sprawl this tool exists to stop. Measured live: a `.cli-core-*`
// copy with types.js at 0 __rufloResolveRoot while the sibling `cli-core/` was fully patched.
function scopedAliasPaths(nm, suffix) {
  if (!suffix[0]?.startsWith('@') || suffix.length < 2) return [];
  const [scope, pkg, ...rest] = suffix;
  const prefix = `.${pkg}-`;
  let siblings;
  try { siblings = fs.readdirSync(path.join(nm, scope)); } catch { return []; }
  const out = [];
  for (const s of siblings) {
    if (!s.startsWith(prefix)) continue;
    // Disambiguate by the package's OWN name, never the prefix: `.cli-core-<hash>` also starts with
    // `.cli-`, so a prefix-only match would patch cli-core when asked for cli. package.json is the
    // authoritative identity — trust it, not the directory string.
    const aliasRoot = path.join(nm, scope, s);
    let meta;
    try { meta = JSON.parse(fs.readFileSync(path.join(aliasRoot, 'package.json'), 'utf8')); } catch { continue; }
    if (meta.name !== `${scope}/${pkg}`) continue;
    const full = path.join(aliasRoot, ...rest);
    if (fs.existsSync(full)) out.push(full);
  }
  return out;
}

function discover(suffix) {
  const found = [];
  for (const nm of nodeModulesDirs()) {
    const full = path.join(nm, ...suffix);
    if (fs.existsSync(full)) found.push(full);
    found.push(...scopedAliasPaths(nm, suffix));
  }
  return found;
}

/** Bounded installed files for one declared entry; used by executable retirement proofs. */
export function filesForEntry(id) {
  const entry = ENTRIES.find((candidate) => candidate.id === id);
  return entry ? discover(entry.suffix) : [];
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
        const dirName = `${scope}/${p}`;
        const root = path.join(scopeRoot, scope, p);
        // Only a build that can actually SPAWN A DAEMON matters here. Libraries
        // (cli-core, neural, agentdb, …) have no daemon path and no memory root.
        if (!fs.existsSync(path.join(root, 'dist', 'src', 'commands', 'daemon.js'))) continue;
        let meta;
        try { meta = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); } catch { continue; }
        // Identify by the package's OWN name, not the directory. npx installs the same package under a
        // content-addressed alias dir (`@claude-flow/.cli-YaBvWJZO`) whose basename never equals
        // `@claude-flow/cli` — a dir-name-only check flagged every such copy as "uncovered" forever
        // even though discover() now patches it via scopedAliasPaths(). The name is the real identity.
        if (KNOWN_CLI_PKGS.includes(dirName) || KNOWN_CLI_PKGS.includes(meta.name)) continue;
        const label = meta.name && meta.name !== dirName ? `${meta.name} (dir ${dirName})` : dirName;
        seen.add(`uncovered ruflo CLI: ${label}@${meta.version} — can spawn daemons, but no patches cover it (add it to KNOWN_CLI_PKGS)`);
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
  if (entry.appliesWhen && !src.includes(entry.appliesWhen)) return false;
  // A static patch marker proves only that *some* revision touched this file.
  // Targets whose injected runtime evolves carry their own exact revision proof,
  // so monitor re-application upgrades old patch bytes from the vendor backup.
  if (entry.proof && !src.includes(entry.proof)) return false;
  // Each edit is satisfied if its replacement is present (applied) OR — for an `optional` edit — its
  // anchor is genuinely absent, so there was nothing to apply. An optional anchor that IS present but
  // was NOT rewritten is unpatched drift, not a benign absence, and must fail this check.
  const edApplied = (e) => {
    if (e.all) {
      // One replacement does not prove a replace-ALL edit complete: a single
      // reverted sibling used to leave both find+replace present and still pass.
      if (src.includes(e.find)) return false;
      return src.includes(e.replace) || e.optional;
    }
    return src.includes(e.replace) || (e.optional && !src.includes(e.find));
  };
  if (!entry.edits.every(edApplied)) return false;
  // Mirror rebuild()'s require-any. A wholly-optional entry that anchored NOTHING is drift, not a
  // clean apply — without this a build missing both state dirs would read as patched on the byte-check
  // surface while rebuild logged skip:anchor-not-found. status/monitor-check and apply MUST agree.
  if (entry.edits.some((e) => e.optional) && !entry.edits.some((e) => src.includes(e.replace))) return false;
  return true;
}

function entryNativeSatisfied(src, entry) {
  if (typeof entry.nativeSatisfied !== 'function') return false;
  try { return entry.nativeSatisfied(src) === true; } catch { return false; }
}

// Is this file OUR output — under any combination of targets?
//
// The MARKER alone is not enough: composePrelude() only emits it when the active entries
// contribute fragments (see :216), so an edits-only entry yields a patched file with no
// marker at all. Fall back to the entries' own replacement text, which is the same signal
// entryApplied() trusts.
//
// These two exact markers recognize edits retired on 2026-07-28. They are not reapplied, but an
// already-patched global/npm cache file must still be recognized as ours long enough to rebuild it
// from its vendor backup. Without this migration signal, the first new monitor tick would rebaseline
// our obsolete bytes as "upstream" and preserve them forever.
const RETIRED_EDIT_MARKERS = [
  'function __rufloEnsureCodexLifecyclePlugin(cwd)',
  'ruflo-source-patch(init): `skills add ruvnet/ruflo --skill ruflo`',
];
function isOurs(src) {
  return src.includes(MARKER)
    || RETIRED_EDIT_MARKERS.some((marker) => src.includes(marker))
    || ENTRIES.some((e) => entryApplied(src, e));
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
      writeIfChanged(backup, current);
      return current;
    }

    if (current !== saved && !isOurs(current)) {
      writeIfChanged(backup, current); // re-baseline: reality outranks our backup
      // Never silent — this means the vendor file changed under us, which is exactly when
      // a human should be looking at whether the anchors still hold.
      // FULL path, not the basename. This line is what the notifier turns into a `diff` command for
      // the reader — and a basename yields `diff daemon-autostart.js.rsp-backup daemon-autostart.js`,
      // which resolves to nothing. Guidance that cannot be run is not guidance.
      result?.log.push(`re-baselined ${file} — upstream replaced it; patching the NEW file`);
      return current;
    }
    return saved;
  }

  if (isOurs(current)) return null; // patched but no backup — refuse to guess
  writeIfChanged(backup, current);
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
    // A behaviorally-proven upstream replacement is a clean success, not an anchor
    // failure. Keep native vendor bytes pristine and do not stamp them as ours.
    if (entryNativeSatisfied(pristine, e)) return false;
    // Exact applicability is distinct from an optional edit. Some older vendor
    // versions genuinely predate the feature an entry patches; do not manufacture
    // permanent drift for code that does not exist. If the feature sentinel exists,
    // every ordinary uniqueness/anchor rule below still applies unchanged.
    if (e.appliesWhen && !pristine.includes(e.appliesWhen)) return false;
    const bad = e.edits.filter((ed) => {
      const n = occurrences(pristine, ed.find);
      // `all` is a property of the EDIT, not the entry — daemon/command-root deliberately marks two of
      // its three edits `all: true`, because `process.cwd()` legitimately appears at several call sites
      // and every one of them must be root-resolved. For those, ANY count >= 1 is correct and 0 is the
      // failure. For every other edit, exactly one occurrence or we do not know where it belongs.
      //
      // `optional` relaxes ONLY the zero case, and only in the direction that cannot corrupt: an
      // optional edit whose anchor is absent is a deliberate no-op (the sibling state dir isn't used
      // in this build). It never excuses an AMBIGUOUS anchor — an optional non-`all` edit that occurs
      // more than once is still refused, because guessing which site to patch is the failure `optional`
      // was never meant to license.
      if (ed.all) return ed.optional ? false : n === 0;
      return ed.optional ? n > 1 : n !== 1;
    });
    if (bad.length) {
      const dup = bad.find((ed) => occurrences(pristine, ed.find) > 1);
      result.log.push(dup
        ? `skip:ambiguous-anchor ${e.id} (${file}) — anchor occurs ${occurrences(pristine, dup.find)}x; upstream restructured, refusing to guess which one to patch`
        : `skip:anchor-not-found ${e.id} (${file})`);
      result.skipped++;
      return false;
    }
    // REQUIRE-ANY for a wholly-optional entry. An entry made entirely of optional edits still exists
    // for a reason: this file writes durable state and must be root-anchored. If NONE of its optional
    // anchors are present, the file no longer writes the state we patched it for — that is real drift,
    // not a benign no-op, and it gets the same loud `skip:anchor-not-found` a moved required anchor
    // would. (An entry with even one REQUIRED edit already guarantees a match here, so this only bites
    // the all-optional case — exactly the paired `.claude-flow`/`.swarm` entries.)
    if (e.edits.some((ed) => ed.optional) && !e.edits.some((ed) => occurrences(pristine, ed.find) >= 1)) {
      result.log.push(`skip:anchor-not-found ${e.id} (${file}) — no state-dir anchor present; the file no longer writes the state this patch roots`);
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
    patched: 0, restored: 0, skipped: 0, unchanged: 0, incomplete: 0, errors: 0, log: [],
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

  // `skip:*` is a refusal to guess, not a successful installation. Re-read the
  // resulting bytes through the same per-entry predicates used by status so a
  // missing anchor, a partially reverted replace-all edit, or a target with no
  // discoverable files makes the mutating command fail honestly as well.
  const found = inspect();
  for (const target of desired) {
    const state = found[target];
    if (!state || state.files === 0) {
      result.incomplete++;
      result.log.push(`INCOMPLETE ${target} — no installed target files discovered`);
    } else if (state.satisfied < state.files) {
      const missing = state.files - state.satisfied;
      result.incomplete += missing;
      result.log.push(`INCOMPLETE ${target} — ${missing}/${state.files} file(s) unsatisfied (${state.patched} patched, ${state.native} native)`);
    }
  }
  return result;
}

/** Which files each target currently touches on disk, and whether they're patched. */
export function inspect() {
  const out = {};
  for (const t of PATCH_TARGETS) out[t] = {
    files: 0, patched: 0, native: 0, satisfied: 0,
  };
  for (const entry of ENTRIES) {
    for (const file of discover(entry.suffix)) {
      try {
        const source = fs.readFileSync(file, 'utf8');
        if (entry.appliesWhen && !source.includes(entry.appliesWhen)) continue;
        out[entry.target].files++;
        // Per-ENTRY, not per-file: a shared file carries one MARKER but may be missing
        // this entry's edits entirely.
        if (entryApplied(source, entry)) {
          out[entry.target].patched++;
          out[entry.target].satisfied++;
        } else if (entryNativeSatisfied(source, entry)) {
          out[entry.target].native++;
          out[entry.target].satisfied++;
        }
      } catch { /* unreadable */ }
    }
  }
  return out;
}

/** Patched Ruflo plugin-command modules that can execute the host updater we inject. */
export function pluginHostCommandFiles() {
  const entry = ENTRIES.find((candidate) => candidate.id === 'plugin-hosts/commands');
  if (!entry) return [];
  return discover(entry.suffix).filter((file) => {
    try { return entryApplied(fs.readFileSync(file, 'utf8'), entry); } catch { return false; }
  });
}
