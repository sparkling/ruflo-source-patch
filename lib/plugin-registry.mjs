// The plugin patch targets, in one place.
//
// `cwd`/`daemon`/`memory` patch @claude-flow/cli and are driven by patch-library.mjs.
// These patch the installed `ruflo-adr` PLUGIN instead. They need their own registry
// because their patchers are self-contained (each owns its own discover/apply/revert)
// rather than entries in a shared edit table.
//
// Both the SessionStart hook and the monitor re-apply this set, exactly as they do for
// the CLI targets. WHY they must: an explicit `/plugin update` fetches a fresh copy of
// `ruflo-adr` and silently drops the patch — and a reverted adr-index patch does not
// announce itself. It just goes back to reporting `Records stored: N/N` while writing
// nothing, and the ADR index quietly rots. That is the same silent-staleness the patch
// exists to fix, so leaving it unmonitored would be self-defeating.

import * as adrTemplate from './adr-template/patcher.mjs';
import * as adrIndex from './adr-index/patcher.mjs';

export const PLUGIN_TARGETS = ['adr-template', 'adr-index'];

export const PLUGIN_INFO = {
  'adr-template': "adr-create's template writes metadata adr-index can't parse (#2659)",
  'adr-index': "adr-index can't update a changed ADR — frozen records, duplicate edges (#2660)",
};

const PATCHERS = {
  'adr-template': adrTemplate,
  'adr-index': adrIndex,
};

/** Re-apply the given plugin targets. Shape mirrors patch-library's apply(). */
export function applyPlugins(targets = []) {
  const out = { patched: 0, unchanged: 0, skipped: 0, incomplete: 0, log: [] };
  for (const t of targets) {
    const p = PATCHERS[t];
    if (!p) continue;
    const r = p.apply();
    out.patched += r.patched || 0;
    out.unchanged += r.unchanged || 0;
    out.skipped += r.skipped || 0;
    out.incomplete += r.incomplete || 0;
    for (const l of r.log) out.log.push(`${t}: ${l}`);
  }
  return out;
}

/** Per-target {files, patched}, same shape patch-library's inspect() returns. */
export function inspectPlugins() {
  const out = {};
  for (const t of PLUGIN_TARGETS) {
    const s = PATCHERS[t].status();
    out[t] = { files: s.files, patched: s.patched };
  }
  return out;
}
