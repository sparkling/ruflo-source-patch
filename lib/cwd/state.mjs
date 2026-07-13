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

export function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    const t = Array.isArray(s.patchTargets) ? s.patchTargets : [];
    const p = Array.isArray(s.pluginTargets) ? s.pluginTargets : [];
    return {
      patchTargets: t.filter((x) => PATCH_TARGETS.includes(x)),
      pluginTargets: p.filter((x) => PLUGIN_TARGETS.includes(x)),
    };
  } catch {
    return { patchTargets: [], pluginTargets: [] };
  }
}

export function writeState(state) {
  fs.mkdirSync(STABLE_DIR, { recursive: true });
  // Canonical order; any legacy `paused` key is dropped on the next write.
  const clean = {
    patchTargets: PATCH_TARGETS.filter((t) => (state.patchTargets || []).includes(t)),
    pluginTargets: PLUGIN_TARGETS.filter((t) => (state.pluginTargets || []).includes(t)),
  };
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(clean, null, 2)}\n`);
  return clean;
}

export function addTargets(targets) {
  const cur = readState();
  return writeState({ ...cur, patchTargets: [...new Set([...cur.patchTargets, ...targets])] });
}

export function removeTargets(targets) {
  const cur = readState();
  const drop = new Set(targets);
  return writeState({ ...cur, patchTargets: cur.patchTargets.filter((t) => !drop.has(t)) });
}

export function addPluginTargets(targets) {
  const cur = readState();
  return writeState({ ...cur, pluginTargets: [...new Set([...cur.pluginTargets, ...targets])] });
}

export function removePluginTargets(targets) {
  const cur = readState();
  const drop = new Set(targets);
  return writeState({ ...cur, pluginTargets: cur.pluginTargets.filter((t) => !drop.has(t)) });
}

/** Nothing installed at all — used to decide whether the SessionStart hook is still earning its keep. */
export function isEmpty(state = readState()) {
  return state.patchTargets.length === 0 && state.pluginTargets.length === 0;
}

export { STATE_PATH, path };
