// The source patcher: rewrites the three cwd-anchoring functions in the
// installed @claude-flow/cli + @claude-flow/cli-core packages to resolve the
// project root (nearest ancestor .git) instead of raw process.cwd().
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

function patchFile(file, target) {
  const backup = `${file}.rsp-backup`;
  let src = fs.readFileSync(file, 'utf8');
  if (src.includes(MARKER)) return 'already-patched';
  for (const e of target.edits) {
    if (!src.includes(e.find)) return `skip:anchor-not-found`;
  }
  if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
  src = (target.prelude || RESOLVER_SRC_ESM) + '\n' + src;
  for (const e of target.edits) src = src.replace(e.find, e.replace);
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
  return result;
}
