// The plugin patch targets, in one place.
//
// `cwd`/`daemon`/`memory` patch @claude-flow/cli and are driven by patch-library.mjs.
// These patch the installed `ruflo-adr` PLUGIN instead. They need their own registry
// because their patchers are self-contained (each owns its own discover/apply/restore)
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
  const out = {
    patched: 0, unchanged: 0, skipped: 0, incomplete: 0, errors: 0, log: [],
  };
  for (const t of targets) {
    const p = PATCHERS[t];
    if (!p) continue;
    // Guard EACH target. patch-library's apply() has always wrapped its per-file work; this
    // did not, and the asymmetry was load-bearing: a throw in here (an unreadable plugin file,
    // a file removed between discover() and read) propagated all the way out of runOnce() into
    // monitor-run.mjs, whose catch block is empty. The damage was never local to the plugin —
    //   1. beat() had already run, so the heartbeat stayed FRESH and the health check reported
    //      a perfectly live monitor;
    //   2. nothing was logged;
    //   3. recordProblems() sits AFTER this call, so anchor breaks in the CLI patches found
    //      EARLIER IN THE SAME TICK were discarded too.
    // One unreadable file blinded the whole watchdog, indefinitely, while it reported health.
    try {
      const r = p.apply();
      out.patched += r.patched || 0;
      out.unchanged += r.unchanged || 0;
      out.skipped += r.skipped || 0;
      out.incomplete += r.incomplete || 0;
      for (const l of r.log) out.log.push(`${t}: ${l}`);
    } catch (err) {
      out.errors++;
      out.log.push(`${t}: error ${err.message}`);
    }
  }
  return out;
}

/** Per-target {files, patched}, same shape patch-library's inspect() returns. */
export function inspectPlugins() {
  const out = {};
  for (const t of PLUGIN_TARGETS) {
    // Same reasoning as applyPlugins(): a throw here reached checkDrift(), which every status
    // and `monitor check` path calls. Report the target as UNPATCHED (0 of 0 known files) —
    // a target we cannot inspect must never be reported as healthy.
    try {
      const s = PATCHERS[t].status();
      out[t] = { files: s.files, patched: s.patched };
    } catch {
      out[t] = { files: 1, patched: 0 };
    }
  }
  return out;
}
