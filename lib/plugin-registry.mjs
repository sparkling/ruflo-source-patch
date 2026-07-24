// The plugin patch targets, in one place.
//
// `cwd`/`daemon`/`memory` patch @claude-flow/cli and are driven by patch-library.mjs.
// These patch installed PLUGINS instead. Four of them (adr-template, adr-index, verify-interface,
// mcp-prefix) patch vendor FILES and now compose through the shared engine (plugin-compose.mjs, ADR-020),
// so a file two of them touch is rebuilt from ONE pristine instead of each fighting over the backup.
// adr-reindex is different: it ADDS a skill file rather than patching one, so it keeps its own patcher.
//
// Both the SessionStart hook and the monitor re-apply this set, exactly as they do for the CLI targets.
// WHY they must: an explicit `/plugin update` fetches a fresh copy of the plugin and silently drops the
// patch — and a reverted patch does not announce itself. adr-index goes back to reporting
// `Records stored: N/N` while writing nothing; mcp-prefix's bundled allowed-tools silently grant nothing
// again under plugin loading. The same silent-staleness the patches exist to fix.

import { applyComposed, statusComposed, COMPOSE_TARGETS } from './plugin-compose.mjs';
import * as adrReindex from './adr-reindex/patcher.mjs';

export const PLUGIN_TARGETS = ['adr-template', 'adr-index', 'adr-reindex', 'verify-interface', 'mcp-prefix', 'design-wall', 'memory-health'];

export const PLUGIN_INFO = {
  'adr-template': "adr-create's template writes metadata adr-index can't parse (#2659)",
  'adr-index': "adr-index can't update a changed ADR — frozen records, duplicate edges (#2660)",
  // Not a fix to an upstream file — it ADDS one: the /adr-reindex skill ruflo-adr doesn't ship.
  // It belongs here rather than with the script targets because it lives INSIDE ruflo-adr, so a
  // `/plugin update` deletes it silently; only the hook + monitor keep it alive.
  'adr-reindex': 'adds the /adr-reindex skill — reconciles the deletions upsert can never reap (#2666)',
  // A DIFFERENT plugin (ruvnet-brain, not ruflo-adr) — but the same shape and the same reason to be a
  // target: a /plugin update reverts the fix silently, and an unpatched gate does not announce itself.
  'verify-interface': "ruvnet-brain's PreToolUse gate blocks any ruflo-* binary, and plain prose (#12)",
  // Spans EVERY ruflo plugin, not one file: their bundled skills/agents name tools mcp__claude-flow__*,
  // which never resolve under plugin loading (Claude Code exposes them as mcp__plugin_ruflo-core_ruflo__*).
  'mcp-prefix': "ruflo plugins' bundled tool refs are mcp__claude-flow__*, dead under plugin loading (#2685)",
  // A THIRD plugin (ruvnet-brain again, different script this time): its design-grade commit gate
  // never checks which repo it is actually running in, so an unrelated repo's plain README.md
  // commit trips the same visual-design ritual meant for ruvnet-brain's own explainer/console pages.
  'design-wall': "ruvnet-brain's design-grade commit gate fires on ANY repo's README, not just its own",
  // A FOURTH ruvnet-brain surface: its Onboarding Console's background cache refresh spawns with the
  // PLUGIN's own cwd instead of the server's, so the memory-health card scores the wrong project.
  'memory-health': "ruvnet-brain's Onboarding Console scores the PLUGIN's own dir, not your project's memory store",
};

/** Re-apply the given plugin targets. Shape mirrors patch-library's apply(). */
export function applyPlugins(targets = []) {
  const out = {
    patched: 0, unchanged: 0, skipped: 0, incomplete: 0, errors: 0, log: [],
  };

  // The four vendor-file patchers compose from one pristine per file. Pass the FULL installed compose
  // set — the engine restores files no longer claimed by any of them.
  const composeSet = targets.filter((t) => COMPOSE_TARGETS.includes(t));
  try {
    const r = applyComposed(composeSet);
    out.patched += r.patched || 0;
    out.unchanged += r.unchanged || 0;
    out.skipped += r.skipped || 0;
    out.incomplete += r.incomplete || 0;
    out.errors += r.errors || 0;
    for (const l of r.log) out.log.push(l);
  } catch (err) {
    // Same reason patch-library wraps its per-file work: a throw here used to propagate into
    // monitor-run.mjs's empty catch, leaving a FRESH heartbeat (a monitor reported healthy) while the
    // problems found earlier in the tick were discarded. One unreadable plugin file blinded the watchdog.
    out.errors++;
    out.log.push(`compose: error ${err.message}`);
  }

  // adr-reindex is not a vendor-file patch — it ADDS a skill; keep it on its own patcher.
  if (targets.includes('adr-reindex')) {
    try {
      const r = adrReindex.apply();
      out.patched += r.patched || 0;
      out.unchanged += r.unchanged || 0;
      out.skipped += r.skipped || 0;
      out.incomplete += r.incomplete || 0;
      for (const l of r.log) out.log.push(`adr-reindex: ${l}`);
    } catch (err) {
      out.errors++;
      out.log.push(`adr-reindex: error ${err.message}`);
    }
  }

  return out;
}

/** Per-target {files, patched}, same shape patch-library's inspect() returns. */
export function inspectPlugins() {
  const out = {};
  let s = {};
  try {
    s = statusComposed();
  } catch {
    // A target we cannot inspect must never read as healthy — report 0 of 0 for each.
    s = {};
  }
  for (const t of COMPOSE_TARGETS) {
    out[t] = s[t] ? { files: s[t].files, patched: s[t].patched } : { files: 1, patched: 0 };
  }
  try {
    const rs = adrReindex.status();
    out['adr-reindex'] = { files: rs.files, patched: rs.patched };
  } catch {
    out['adr-reindex'] = { files: 1, patched: 0 };
  }
  return out;
}
