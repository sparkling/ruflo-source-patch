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

import fs from 'node:fs';
import path from 'node:path';
import { STATE_PATH, STABLE_DIR } from './paths.mjs';
import { PATCH_TARGETS } from './patch-library.mjs';

export function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    const t = Array.isArray(s.patchTargets) ? s.patchTargets : [];
    return { patchTargets: t.filter((x) => PATCH_TARGETS.includes(x)) };
  } catch {
    return { patchTargets: [] };
  }
}

export function writeState(state) {
  fs.mkdirSync(STABLE_DIR, { recursive: true });
  // Canonical order; any legacy `paused` key is dropped on the next write.
  const clean = { patchTargets: PATCH_TARGETS.filter((t) => state.patchTargets.includes(t)) };
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(clean, null, 2)}\n`);
  return clean;
}

export function addTargets(targets) {
  const cur = readState();
  return writeState({ patchTargets: [...new Set([...cur.patchTargets, ...targets])] });
}

export function removeTargets(targets) {
  const cur = readState();
  const drop = new Set(targets);
  return writeState({ patchTargets: cur.patchTargets.filter((t) => !drop.has(t)) });
}

// Pre-2.0 installs had no state file: one `cwd install` patched everything. If files are
// patched but no state exists, treat every target as installed so an upgrade doesn't
// silently unpatch a working machine on the next hook/monitor run.
export function migrateLegacyState(anyPatched) {
  if (fs.existsSync(STATE_PATH)) return readState();
  if (!anyPatched) return readState();
  return writeState({ patchTargets: [...PATCH_TARGETS] });
}

export { STATE_PATH, path };
