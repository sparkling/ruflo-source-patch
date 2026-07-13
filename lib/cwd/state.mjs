// Which patch targets the user has installed.
//
// The patcher rebuilds each library file from its pristine backup to be exactly
// "pristine + the entries of the installed targets", so this list IS the source of
// truth for what should be on disk. The SessionStart hook reads it to re-apply the
// same set to any npx copy fetched later.

import fs from 'node:fs';
import path from 'node:path';
import { STATE_PATH, STABLE_DIR } from './paths.mjs';
import { PATCH_TARGETS } from './patch-library.mjs';

export function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    const t = Array.isArray(s.patchTargets) ? s.patchTargets : [];
    return { patchTargets: t.filter((x) => PATCH_TARGETS.includes(x)), paused: s.paused === true };
  } catch {
    return { patchTargets: [], paused: false };
  }
}

export function writeState(state) {
  fs.mkdirSync(STABLE_DIR, { recursive: true });
  const clean = {
    patchTargets: PATCH_TARGETS.filter((t) => state.patchTargets.includes(t)), // canonical order
    // `revert` unpatches the disk but KEEPS intent. Without this flag the monitor would
    // silently re-apply within one tick, making `revert` useless (and baffling) for anyone
    // reverting to debug. Cleared by `patch` / `install`.
    paused: state.paused === true,
  };
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(clean, null, 2)}\n`);
  return clean;
}

export function addTargets(targets) {
  const cur = readState();
  return writeState({ patchTargets: [...new Set([...cur.patchTargets, ...targets])], paused: false });
}

export function setPaused(paused) {
  const cur = readState();
  return writeState({ ...cur, paused });
}

export function removeTargets(targets) {
  const cur = readState();
  const drop = new Set(targets);
  return writeState({ patchTargets: cur.patchTargets.filter((t) => !drop.has(t)), paused: cur.paused });
}

// Pre-2.0 installs had no state file: one `cwd install` patched everything. If files
// are patched but no state exists, treat every target as installed so an upgrade
// doesn't silently unpatch a working machine on the next hook run.
export function migrateLegacyState(anyPatched) {
  if (fs.existsSync(STATE_PATH)) return readState();
  if (!anyPatched) return readState();
  return writeState({ patchTargets: [...PATCH_TARGETS], paused: false });
}

export { STATE_PATH, path };
