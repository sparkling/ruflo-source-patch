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
import { STATE_PATH, STABLE_DIR } from './paths.mjs';
import { PATCH_TARGETS } from './patch-library.mjs';
import { PLUGIN_TARGETS } from '../plugin-registry.mjs';

const KNOWN = (t) => PATCH_TARGETS.includes(t) || PLUGIN_TARGETS.includes(t);

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
  } catch {
    return { patchTargets: [], pluginTargets: [], retired: {}, all: false };
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
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(clean, null, 2)}\n`);
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
