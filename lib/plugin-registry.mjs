// The plugin patch targets, in one place.
//
// `cwd`/`daemon`/`memory` patch @claude-flow/cli and are driven by patch-library.mjs.
// These patch installed PLUGINS instead. Vendor-file targets compose through the shared engine
// (plugin-compose.mjs, ADR-020), so a file two of them touch is rebuilt from ONE pristine instead of
// each fighting over the backup. Additive/disjoint skill targets keep their own exact ownership.
//
// Both the SessionStart hook and the monitor re-apply this set, exactly as they do for the CLI targets.
// WHY they must: an explicit `/plugin update` fetches a fresh copy of the plugin and silently drops the
// patch — and a reverted patch does not announce itself. adr-index goes back to reporting
// `Records stored: N/N` while writing nothing; mcp-prefix's bundled allowed-tools silently grant nothing
// again under plugin loading. The same silent-staleness the patches exist to fix.

import { applyComposed, statusComposed, COMPOSE_TARGETS } from './plugin-compose.mjs';
import * as adrReindex from './adr-reindex/patcher.mjs';
import * as codexHooks from './codex-hooks/patcher.mjs';
import * as codexSkills from './codex-skills/patcher.mjs';
import * as brainManagedMemoryBoundary from './brain-managed-memory-boundary/patcher.mjs';

export const PLUGIN_TARGETS = ['adr-template', 'adr-index', 'adr-io-safety', 'adr-reindex', 'verify-interface', 'ruflo-hooks-schema', 'mcp-prefix', 'design-wall', 'flywheel-daily', 'codex-hooks', 'ruflo-codex-skills', 'brain-codex-skills', 'brain-console-lifecycle', 'brain-console-provider-keys', 'brain-release-lockstep', 'brain-memory-doctor-roots', 'brain-managed-memory-boundary', 'brain-search-safety', 'brain-dual-host-receipt', 'metaharness-codex-hooks', 'ruflo-instruction-contract'];

export const PLUGIN_INFO = {
  'adr-template': "adr-create's template writes metadata adr-index can't parse (#2659)",
  'adr-index': 'legacy convergence compatibility; retires on active native behavior proof (#2660)',
  'adr-io-safety': 'fails closed on incomplete ADR reads/writes and refuses unsafe purge-first reindex (#3147/#3097)',
  // On older ruflo-adr copies this ADDS /adr-reindex. It belongs here rather than with the script
  // targets because it lives INSIDE the plugin; the native replacement retires it only after the
  // skill, purge command, and ordinary-writer lock all pass locally.
  'adr-reindex': 'legacy /adr-reindex for CLIs without a runnable, shared-lock native replacement (#2666)',
  // A DIFFERENT plugin (ruvnet-brain, not ruflo-adr) — but the same shape and the same reason to be a
  // target: a /plugin update reverts the fix silently, and an unpatched gate does not announce itself.
  'verify-interface': "ruvnet-brain's PreToolUse gate blocks any ruflo-* binary, and plain prose (#12)",
  // Ruflo's canonical hook manifest has Codex-invalid metadata, and its shared PreToolUse shim
  // emits a Cursor-only response. The target changes only Codex's marketplace/cache copies.
  'ruflo-hooks-schema': "legacy Codex manifest/PreToolUse repair; retires on native strict-schema behavior (#2816)",
  // Spans EVERY ruflo plugin, not one file: their bundled skills/agents name tools mcp__claude-flow__*,
  // which never resolve under plugin loading (Claude Code exposes them as mcp__plugin_ruflo-core_ruflo__*).
  'mcp-prefix': "legacy #2685 namespace rewrite; self-retires on current Ruflo HEAD plus exact local proof",
  // A THIRD plugin (ruvnet-brain again, different script this time): its design-grade commit gate
  // never checks which repo it is actually running in, so an unrelated repo's plain README.md
  // commit trips the same visual-design ritual meant for ruvnet-brain's own explainer/console pages.
  'design-wall': "legacy ruvnet-brain repo-scope fix; self-retires when upstream's issue #17 identity gate is verified",
  // UserPromptSubmit runs once per prompt in both hosts. An instruction saying "once per session"
  // cannot rate-limit the hook itself, so the hook atomically claims one advisory per day/project.
  'flywheel-daily': "rate-limits Brain's repeated flywheel opt-in advisory per project/day (#53)",
  // Additive Codex plugin packaging plus the minimum host adapter. The existing standalone Brain MCP
  // registration stays authoritative, so this target cannot create a duplicate search_ruvnet server.
  'codex-hooks': "legacy Brain lifecycle packaging; retires on the native stable Codex hook spine (#52)",
  'ruflo-codex-skills': 'legacy Ruflo status skill; retires on a native read-only Codex workflow (#2821)',
  'brain-codex-skills': 'legacy Brain whats-new repair; retires on its executable immutable installed workflow (#76)',
  'brain-console-lifecycle': 'adds the live doctor comparison missing from Brain\'s native Console lifecycle (#79)',
  'brain-console-provider-keys': 'legacy catalog fallback; retires on staged catalog plus honest degraded-state behavior (#86)',
  'brain-release-lockstep': 'makes Brain version drift fail closed without altering its native updater (stuinfla/ruvnet-brain#77)',
  'brain-memory-doctor-roots': 'legacy fleet-root repair; retires on shared common/configured-root behavior (#81)',
  'brain-managed-memory-boundary': 'structurally refuses raw SQLite access to managed AgentDB stores and exposes one audited diagnostic (#102/#103)',
  'brain-search-safety': 'guards source symbol lookup and refuses unproved automatic Brain repair (#224/#225)',
  'brain-dual-host-receipt': 'keeps dual-host receipt persistence on the caller\'s structured MCP boundary (#272)',
  'metaharness-codex-hooks': 'renders declared MetaHarness hooks as native project Codex hooks (ruvnet/metaharness#168)',
  'ruflo-instruction-contract': 'makes generated Claude/Codex roots and packaged skills use live structured Ruflo interfaces first (#3153)',
};

/** Re-apply the given plugin targets. Shape mirrors patch-library's apply(). */
export function applyPlugins(targets = []) {
  const out = {
    patched: 0, unchanged: 0, skipped: 0, incomplete: 0, errors: 0, log: [],
  };

  // The vendor-file patchers compose from one pristine per file. Pass the FULL installed compose
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

  // Also additive, but in a different plugin: legacy Codex lifecycle packaging. Current Brain ships
  // it natively and the target retires on proof; old active generations still use this path.
  if (targets.includes('codex-hooks')) {
    try {
      const r = codexHooks.apply();
      out.patched += r.patched || 0;
      out.unchanged += r.unchanged || 0;
      out.skipped += r.skipped || 0;
      out.incomplete += r.incomplete || 0;
      out.errors += r.errors || 0;
      for (const l of r.log) out.log.push(`codex-hooks: ${l}`);
    } catch (err) {
      out.errors++;
      out.log.push(`codex-hooks: error ${err.message}`);
    }
  }

  for (const target of ['ruflo-codex-skills', 'brain-codex-skills']) {
    if (!targets.includes(target)) continue;
    try {
      const r = codexSkills.apply(target);
      out.patched += r.patched || 0;
      out.unchanged += r.unchanged || 0;
      out.skipped += r.skipped || 0;
      out.incomplete += r.incomplete || 0;
      out.errors += r.errors || 0;
      for (const l of r.log) out.log.push(`${target}: ${l}`);
    } catch (err) {
      out.errors++;
      out.log.push(`${target}: error ${err.message}`);
    }
  }

  if (targets.includes('brain-managed-memory-boundary')) {
    try {
      const r = brainManagedMemoryBoundary.apply();
      out.patched += r.patched || 0;
      out.unchanged += r.unchanged || 0;
      out.incomplete += r.incomplete || 0;
      out.errors += r.errors || 0;
      for (const l of r.log) out.log.push(`brain-managed-memory-boundary: ${l}`);
    } catch (err) {
      out.errors++;
      out.log.push(`brain-managed-memory-boundary: error ${err.message}`);
    }
  }

  return out;
}

/** Per-target {files, patched}, same shape patch-library's inspect() returns. */
export function inspectPlugins(targets = PLUGIN_TARGETS) {
  const wanted = new Set(targets);
  const out = {};
  let s = {};
  if (COMPOSE_TARGETS.some((target) => wanted.has(target))) {
    try {
      s = statusComposed();
    } catch {
      // A target we cannot inspect must never read as healthy — report 0 of 0 for each.
      s = {};
    }
  }
  for (const t of COMPOSE_TARGETS) {
    if (!wanted.has(t)) continue;
    out[t] = s[t] ? { files: s[t].files, patched: s[t].patched } : { files: 1, patched: 0 };
  }
  if (wanted.has('adr-reindex')) {
    try {
      const rs = adrReindex.status();
      out['adr-reindex'] = { files: rs.files, patched: rs.patched };
    } catch {
      out['adr-reindex'] = { files: 1, patched: 0 };
    }
  }
  if (wanted.has('codex-hooks')) {
    try {
      const cs = codexHooks.status();
      out['codex-hooks'] = { files: cs.files, patched: cs.patched };
    } catch {
      out['codex-hooks'] = { files: 6, patched: 0 };
    }
  }
  for (const target of ['ruflo-codex-skills', 'brain-codex-skills']) {
    if (!wanted.has(target)) continue;
    try {
      const cs = codexSkills.status(target);
      out[target] = { files: cs.files, patched: cs.patched };
    } catch {
      out[target] = { files: codexSkills.expectedFiles(target), patched: 0 };
    }
  }
  if (wanted.has('brain-managed-memory-boundary')) {
    try {
      const bs = brainManagedMemoryBoundary.status();
      out['brain-managed-memory-boundary'] = { files: bs.files, patched: bs.patched };
    } catch {
      out['brain-managed-memory-boundary'] = { files: 6, patched: 0 };
    }
  }
  return out;
}
