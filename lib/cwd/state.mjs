// Which patch targets the user has installed.
//
// The patcher rebuilds each library file from its pristine backup to be exactly
// "pristine + the entries of the installed targets", so this list IS the source of
// truth for what should be on disk. The SessionStart hook and the monitor both read it
// to re-apply the same set to any npx copy fetched later.
//
// There is deliberately NO "paused"/"reverted" state. An earlier version had one, to
// support a `revert` action — but `revert` left the library BYTE-IDENTICAL to what
// `uninstall` leaves, so it was `uninstall` with extra bookkeeping (and it shipped two
// bugs of its own: it ignored its target argument, and the monitor undid it within one
// tick). If you want a target off, uninstall it; install it again to get it back.
//
// `revert` therefore names NOTHING in this codebase — and the internal function that puts a
// file back from its .rsp-backup is called `restore()`, not `revert()`, precisely so that
// nobody reads it as leftovers from the deleted action. It is not dead code: it IS uninstall.
// (Mistaking it for dead code is not hypothetical — it nearly buried a bug where an empty
// backup made `uninstall` truncate the file it was supposed to be restoring.)

// `pluginTargets` is a SECOND, independent list: the ruflo-adr plugin patches
// (adr-template, adr-index). They live apart from `patchTargets` because they patch a
// different thing (an installed Claude Code plugin, not @claude-flow/cli) and are driven
// by a different engine — but the hook and the monitor re-apply BOTH, so both must be
// recorded here. A state file predating this key simply reads back an empty list.

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { STATE_PATH, STABLE_DIR } from './paths.mjs';
import { PATCH_TARGETS } from './patch-library.mjs';
import { PLUGIN_TARGETS } from '../plugin-registry.mjs';

const KNOWN = (t) => PATCH_TARGETS.includes(t) || PLUGIN_TARGETS.includes(t);

// ─── whole-mutation lock ────────────────────────────────────────────────────
//
// The state lock below protects one read-modify-write of state.json. That is necessary, but it is
// not sufficient: after recording the new set, every mutating command rebuilds the SAME vendor files
// and their shared `.rsp-backup` files. Three concurrent installs were therefore able to serialize
// state.json and then race in copyFileSync()/renameSync. Reproduced on macOS: one process observed an
// in-flight zero-byte backup and remained in the kernel copy path indefinitely.
//
// This outer lock makes "change desired state + make disk match it" one transaction. The monitor and
// SessionStart re-apply path use it too, so they cannot race a foreground install. Unlike the smaller
// state lock, this one FAILS CLOSED on timeout: proceeding unlocked is precisely the corruption path
// it exists to prevent.
export const PATCH_MUTATION_LOCK_PATH = `${STATE_PATH}.mutation.lock`;
export const PATCH_MUTATION_RECOVERY_PATH = `${PATCH_MUTATION_LOCK_PATH}.recovery`;
const configuredPatchLockTimeout = Number(process.env.RSP_PATCH_LOCK_TIMEOUT_MS);
export const PATCH_LOCK_TIMEOUT_MS = Number.isFinite(configuredPatchLockTimeout)
  && Number.isInteger(configuredPatchLockTimeout)
  && configuredPatchLockTimeout >= 1000
  ? configuredPatchLockTimeout
  : 30000;
const PATCH_LOCK_WAIT_CELL = new Int32Array(new SharedArrayBuffer(4));
let heldMutationToken = null;
let heldMutationDepth = 0;

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === 'EPERM';
  }
}

function readClaim(file) {
  try {
    const claim = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Number.isInteger(claim?.pid) || claim.pid <= 0 || typeof claim?.token !== 'string' || !claim.token) {
      return null;
    }
    return claim;
  } catch {
    return null;
  }
}

// Publish complete ownership metadata atomically. Creating the public lock path directly leaves an
// empty-file crash window between open() and write(); a hard link from a fully-written private
// candidate has O_EXCL semantics and means every visible claim is parseable from its first instant.
function createClaim(file, claim) {
  const candidate = `${file}.candidate-${process.pid}-${claim.token}`;
  let fd;
  try {
    fd = fs.openSync(candidate, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(claim)}\n`);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    try {
      fs.linkSync(candidate, file);
      return true;
    } catch (err) {
      if (err?.code === 'EEXIST') return false;
      throw err;
    }
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
    try { fs.rmSync(candidate, { force: true }); } catch { /* surfaced by later artifact checks */ }
  }
}

function removeClaimIfOwned(file, token) {
  if (readClaim(file)?.token !== token) return false;
  fs.rmSync(file, { force: true });
  return true;
}

function waitForClaim(deadline, holder, kind = 'patch mutation') {
  if (Date.now() >= deadline) {
    const owner = holder?.pid ? ` (pid ${holder.pid})` : '';
    throw new Error(`timed out waiting for another ${kind}${owner}; refusing to rewrite shared vendor files concurrently`);
  }
  Atomics.wait(PATCH_LOCK_WAIT_CELL, 0, 0, 10);
}

/**
 * Acquire the cross-process lock guarding a complete patch mutation.
 *
 * Re-entrant within one process because the CLI owns the broad transaction while monitor/re-apply
 * helpers also defend themselves when invoked directly.
 */
export function acquirePatchMutationLock() {
  if (heldMutationToken !== null) {
    heldMutationDepth++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      heldMutationDepth--;
    };
  }

  fs.mkdirSync(STABLE_DIR, { recursive: true });
  const deadline = Date.now() + PATCH_LOCK_TIMEOUT_MS;
  const token = randomUUID();
  const claim = { pid: process.pid, token, startedAt: new Date().toISOString() };

  for (;;) {
    const recovery = readClaim(PATCH_MUTATION_RECOVERY_PATH);
    if (fs.existsSync(PATCH_MUTATION_RECOVERY_PATH)) {
      // A recovery claim is deliberately never stolen automatically. It guards the operation that
      // removes a dead owner's main lock; recursively "recovering the recovery lock" would recreate
      // the same check-then-delete race one level down. A crashed recovery therefore fails closed.
      waitForClaim(deadline, recovery, 'patch-lock recovery');
      continue;
    }

    if (createClaim(PATCH_MUTATION_LOCK_PATH, claim)) {
      // A reaper may have acquired its guard after our first check but before this link. In that
      // schedule, relinquish our own token and retry after recovery completes; never make it guess
      // whether our newly-live claim is the dead one it observed earlier.
      if (fs.existsSync(PATCH_MUTATION_RECOVERY_PATH)) {
        removeClaimIfOwned(PATCH_MUTATION_LOCK_PATH, token);
        waitForClaim(deadline, readClaim(PATCH_MUTATION_RECOVERY_PATH), 'patch-lock recovery');
        continue;
      }
      heldMutationToken = token;
      heldMutationDepth = 1;
      break;
    }

    const holder = readClaim(PATCH_MUTATION_LOCK_PATH);
    if (holder && !processIsAlive(holder.pid)) {
      const recoveryToken = randomUUID();
      const recoveryClaim = {
        pid: process.pid,
        token: recoveryToken,
        startedAt: new Date().toISOString(),
        recoveringToken: holder.token,
      };
      if (createClaim(PATCH_MUTATION_RECOVERY_PATH, recoveryClaim)) {
        try {
          // Re-read under the recovery guard. Every acquirer checks this guard before and after
          // publishing its main claim, so the token can no longer change beneath this decision.
          const observed = readClaim(PATCH_MUTATION_LOCK_PATH);
          if (observed?.token === holder.token && !processIsAlive(observed.pid)) {
            removeClaimIfOwned(PATCH_MUTATION_LOCK_PATH, observed.token);
          }
        } finally {
          removeClaimIfOwned(PATCH_MUTATION_RECOVERY_PATH, recoveryToken);
        }
        continue;
      }
    }

    // A malformed main claim has no provably dead owner, so age alone is never permission to delete
    // it. This can require manual repair, but it cannot turn uncertainty into concurrent mutation.
    waitForClaim(deadline, holder);
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    heldMutationDepth--;
    if (heldMutationDepth > 0) return;

    try {
      removeClaimIfOwned(PATCH_MUTATION_LOCK_PATH, heldMutationToken);
    } finally {
      heldMutationToken = null;
      heldMutationDepth = 0;
    }
  };
}

export function withPatchMutationLock(fn) {
  const release = acquirePatchMutationLock();
  try {
    return fn();
  } finally {
    release();
  }
}

export function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    const t = Array.isArray(s.patchTargets) ? s.patchTargets : [];
    const p = Array.isArray(s.pluginTargets) ? s.pluginTargets : [];
    return {
      patchTargets: t.filter((x) => PATCH_TARGETS.includes(x)),
      pluginTargets: p.filter((x) => PLUGIN_TARGETS.includes(x)),
      // RETIRED IS TERMINAL, and it has to be, or the tool fights itself: the SessionStart hook
      // re-applies everything in this file and `make install` installs every target, so an uninstall
      // with no memory of WHY would be undone within the hour and redone on the next monitor tick.
      // Flip-flopping forever is worse than never retiring at all.
      retired: (s.retired && typeof s.retired === 'object') ? s.retired : {},
      // `all` records the "keep me on the COMPLETE, current set" contract, set by `all install`. It is
      // what makes a new target introduced in a later release adopt itself: the self-update re-runs
      // `all install` (ADR-019) instead of `monitor install`, so the new target lands in the lists above
      // and the hook/monitor re-apply it like any other. Any single-target uninstall clears it — the
      // moment you curate a subset, you have stopped asking for "everything", and the tool respects that.
      all: Boolean(s.all),
    };
  } catch (err) {
    if (err?.code === 'ENOENT') {
      return { patchTargets: [], pluginTargets: [], retired: {}, all: false };
    }
    throw new Error(`cannot read ${STATE_PATH}: ${err.message}; refusing to treat unreadable desired state as empty`);
  }
}

export function writeState(state) {
  fs.mkdirSync(STABLE_DIR, { recursive: true });
  // Canonical order; any legacy `paused` key is dropped on the next write.
  const clean = {
    patchTargets: PATCH_TARGETS.filter((t) => (state.patchTargets || []).includes(t)),
    pluginTargets: PLUGIN_TARGETS.filter((t) => (state.pluginTargets || []).includes(t)),
    retired: state.retired && typeof state.retired === 'object' ? state.retired : {},
    all: Boolean(state.all),
  };
  const tmp = path.join(STABLE_DIR, `.state.json.rsp-tmp-${process.pid}-${randomUUID()}`);
  let fd;
  try {
    fd = fs.openSync(tmp, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(clean, null, 2)}\n`);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, STATE_PATH);
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
    try { fs.rmSync(tmp, { force: true }); } catch { /* surfaced by artifact checks */ }
  }
  return clean;
}

// ─── the cross-process lock ──────────────────────────────────────────────────
//
// Every mutation below is a READ-MODIFY-WRITE of state.json, and until now none of them held a lock.
// Two concurrent installs each read the same image and each wrote it back; the second clobbered the
// first. Measured: THREE concurrent `install`s lost a target in 12 runs out of 12. Not a rare race —
// the default outcome.
//
// And losing a target here is not a cosmetic bookkeeping slip. state.json is what the SessionStart hook
// and the monitor re-apply FROM: apply(state.patchTargets) makes the library match that list EXACTLY. So
// a target dropped from the file is a target the next monitor tick actively UN-PATCHES. A concurrent
// install doesn't just fail to record — it silently reverts a patch that is already applied.
//
// This is the exact bug class this package exists to fix in ruflo's memory.db (#2621: last-writer-wins
// silently drops writes). Having it in our own state file was not acceptable.
//
// Same discipline as the memLock fragment we inject into ruflo: O_EXCL create, steal after 15s (the
// holder died mid-write), give up after 5s and proceed UNLOCKED rather than break the command — a
// degraded write is bad, a tool that refuses to run is worse.
const LOCK_PATH = `${STATE_PATH}.lock`;

function withLock(fn) {
  const deadline = Date.now() + 5000;
  let fd = null;
  for (;;) {
    try {
      fs.mkdirSync(STABLE_DIR, { recursive: true });
      fd = fs.openSync(LOCK_PATH, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
      break;
    } catch (e) {
      if (!e || e.code !== 'EEXIST') break;            // cannot lock at all — proceed unlocked
      try {
        const st = fs.statSync(LOCK_PATH);
        if (Date.now() - st.mtimeMs > 15000) { fs.rmSync(LOCK_PATH, { force: true }); continue; }
      } catch { continue; }                             // vanished under us — retry
      if (Date.now() > deadline) break;                 // timed out — proceed unlocked
      // Busy-wait briefly. Sync by necessity: every caller here is synchronous.
      const until = Date.now() + 10;
      while (Date.now() < until) { /* spin */ }
    }
  }

  try {
    return fn();
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
      try { fs.rmSync(LOCK_PATH, { force: true }); } catch { /* ignore */ }
    }
  }
}

// Each of these now reads and writes INSIDE the lock, so the read cannot be stale by the time we write.
export function addTargets(targets) {
  return withLock(() => {
    const cur = readState();
    return writeState({ ...cur, patchTargets: [...new Set([...cur.patchTargets, ...targets])] });
  });
}

export function removeTargets(targets) {
  return withLock(() => {
    const cur = readState();
    const drop = new Set(targets);
    return writeState({ ...cur, patchTargets: cur.patchTargets.filter((t) => !drop.has(t)) });
  });
}

export function addPluginTargets(targets) {
  return withLock(() => {
    const cur = readState();
    return writeState({ ...cur, pluginTargets: [...new Set([...cur.pluginTargets, ...targets])] });
  });
}

export function removePluginTargets(targets) {
  return withLock(() => {
    const cur = readState();
    const drop = new Set(targets);
    return writeState({ ...cur, pluginTargets: cur.pluginTargets.filter((t) => !drop.has(t)) });
  });
}

// ─── retirement ─────────────────────────────────────────────────────────────
//
// Retiring is NOT the same operation as uninstalling, even though it ends with the file removed.
// Uninstalling is the user saying "not for me". Retiring is the tool saying "something else does this
// now, and I checked" — so it is recorded, with its evidence, and it STICKS.

/** Record a target as retired and drop it from the installed sets. Terminal. */
export function retireTarget(target, { reason, evidence, issue }) {
  return withLock(() => {
    const cur = readState();
    return writeState({
      ...cur,
      patchTargets: cur.patchTargets.filter((t) => t !== target),
      pluginTargets: cur.pluginTargets.filter((t) => t !== target),
      retired: {
        ...cur.retired,
        // The evidence is stored, not just the verdict. A retirement someone cannot audit later is
        // indistinguishable from a bug that ate their patch.
        [target]: { reason, evidence, issue, at: new Date().toISOString() },
      },
    });
  });
}

export const isRetired = (target, state = readState()) => Boolean(state.retired[target]);

// ─── the "track the complete set" contract ───────────────────────────────────
//
// `all install` turns this ON; `all uninstall` and ANY single-target uninstall turn it OFF. It is the
// one bit the self-update reads to decide whether to re-run `all install` (adopt new targets) or just
// `monitor install` (keep exactly the recorded set). See ADR-019 and update-check.mjs. Deliberately a
// plain boolean, not a per-target opt-out map: "everything, kept live" and "this curated subset" are the
// only two contracts worth modelling — an opt-out list is a third state that has to be tested and can
// drift, for a case (all-except-a-few) nobody has asked for.
export function setAllMode(on) {
  return withLock(() => writeState({ ...readState(), all: Boolean(on) }));
}

export const isAllMode = (state = readState()) => Boolean(state.all);

/** Nothing installed at all — used to decide whether the SessionStart hook is still earning its keep. */
export function isEmpty(state = readState()) {
  return state.patchTargets.length === 0 && state.pluginTargets.length === 0;
}

export { STATE_PATH, path };
