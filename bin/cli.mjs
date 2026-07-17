#!/usr/bin/env node
// ruflo-source-patch — multi-target CLI.
//
//   npx github:sparkling/ruflo-source-patch <target> <action>
//
// The FIRST argument is the target, the second the action. Every target installs and
// uninstalls independently — `memory uninstall` leaves `cwd` in place even though both
// patch the same file (the patcher rebuilds each file from its pristine backup).
//
// Patch targets (source patches to the installed @claude-flow/cli):
//   cwd      cwd anchoring — .claude-flow/.swarm stop following a drifted cwd (#2633)
//   daemon   daemon dedup — one daemon per project root (#2633 / #2407 / #2484)
//   memory   memory.db durability — write lock (#2621) + WAL-coherent reads (#2584)
//
// Plugin patches (changes to the installed `ruflo-adr` plugin, not @claude-flow/cli — same
// install/uninstall/status shape, different target file). Together they cover the whole ADR
// round-trip: what adr-create WRITES, what adr-index READS BACK IN, and what neither can REAP.
//   adr-template   adr-create's own template writes bullet-list metadata that
//                  adr-index's parser can't read (#2659)
//   adr-index      adr-index can't update a CHANGED ADR: records are frozen by a
//                  strict insert, edges duplicate on every run (#2660 / #2594)
//   adr-reindex    ADDS the /adr-reindex skill (upstream ships no such command — #2666) + the script
//                  it invokes. Reconciles DELETIONS, which upsert can never reap. Requires `memory`.
//
// Why adr-reindex is a PLUGIN target and not a script one, though it materializes a script: the
// skill file lives INSIDE ruflo-adr, and a `/plugin update` re-fetches that plugin wholesale and
// deletes the skill — silently. Only state.json + the SessionStart hook + the monitor put it back,
// and script targets have none of those.
//
// Infra target:
//   monitor  keep the patches live — a scheduled re-apply, because `npx` fetching a new
//            copy (or a `ruflo update`) silently replaces a patched file and the
//            SessionStart hook only fires at session START.
//
// Script targets (materialize scripts; no patching, no hook):
//   dual-codex-claude   single-source dual Claude Code + Codex project toolkit
//   dedupe-bundle       slim a .claude bundle left behind by `ruflo init --full` (#2640)
//
// There is no `all` and no bare-action default: every invocation names its target. An
// `all` that silently meant "the three patch targets, but not the monitor and not the
// script targets" was a lie in the name — and a default that installs things you didn't
// ask for is worse than typing three words.

import { patchCommand, monitorCommand } from '../lib/cwd/commands.mjs';
import { runCleanup } from '../lib/cwd/cleanup.mjs';
import { PATCH_TARGETS, TARGET_INFO } from '../lib/cwd/patch-library.mjs';
import { scriptCommand, SCRIPT_TARGETS } from '../lib/dual/commands.mjs';
import { adrTemplateCommand } from '../lib/adr-template/commands.mjs';
import { adrIndexCommand } from '../lib/adr-index/commands.mjs';
import { adrReindexCommand } from '../lib/adr-reindex/commands.mjs';
import { verifyInterfaceCommand } from '../lib/verify-interface/commands.mjs';
import { mcpPrefixCommand } from '../lib/mcp-prefix/commands.mjs';
import { designWallCommand } from '../lib/design-wall/commands.mjs';

const ACTIONS = new Set(['install', 'init', 'uninstall', 'remove', 'status', 'run', 'check']);
// `plugin-only` is the current name (it does more than dedupe a bundle now: strips the plugin-duplicated
// bundle, double-firing hooks, the standalone MCP registration in both channels, and stops its server).
// `dedupe` / `dedupe-bundle` stay as aliases; the internal key + materialized dir stay `dedupe-bundle` so
// existing installs and the monitor's byte-compare are undisturbed.
const ALIASES = { dual: 'dual-codex-claude', dedupe: 'dedupe-bundle', 'plugin-only': 'dedupe-bundle' };

// Plugin patches — same shape as PATCH_TARGETS, but they patch the installed
// `ruflo-adr` plugin rather than @claude-flow/cli, so they dispatch separately.
const PLUGIN_PATCH_TARGETS = {
  'adr-template': adrTemplateCommand,
  'adr-index': adrIndexCommand,
  // Adds the /adr-reindex SKILL to ruflo-adr (and materializes the script it invokes). A plugin
  // target, not a script one: the skill lives inside ruflo-adr, so `/plugin update` deletes it.
  'adr-reindex': adrReindexCommand,
  // ruvnet-brain, not ruflo-adr — same machinery, different plugin.
  'verify-interface': verifyInterfaceCommand,
  // Spans ALL ruflo plugins: rewrites bundled mcp__claude-flow__* refs to the plugin-namespaced
  // form so they resolve under plugin loading (#2685). Same machinery, widest blast radius.
  'mcp-prefix': mcpPrefixCommand,
  // ruvnet-brain again, a different script: its design-grade commit gate never checks which repo
  // it is running in before demanding a visual design ritual for a plain README.md commit.
  'design-wall': designWallCommand,
};

function usage() {
  const pad = (s) => s.padEnd(18);
  console.log(`ruflo-source-patch — patch ruflo/@claude-flow at source; project toolkits

Usage:
  npx github:sparkling/ruflo-source-patch <target> <action>

Everything at once              (actions: install | uninstall | status)
  ${pad('all')}every patch + plugin target + the monitor, in one command (== make install)

Patch targets                  (actions: install | uninstall | status)
  ${pad('cwd')}${TARGET_INFO.cwd}
  ${pad('daemon')}${TARGET_INFO.daemon}
  ${pad('memory')}${TARGET_INFO.memory}
  ${pad('init')}${TARGET_INFO.init}

Plugin patches (ruflo-adr)     (actions: install | uninstall | status)
  ${pad('adr-template')}adr-create's own template writes unparseable bullet-list metadata (#2659)
  ${pad('adr-index')}adr-index can't update a changed ADR — frozen records, duplicate edges (#2660)
  ${pad('adr-reindex')}ADDS the /adr-reindex skill — reconcile the deletions upsert can't reap
  ${pad('')}  (requires \`memory\`: it hard-deletes rows and needs the write lock)

Plugin patches (ruvnet-brain)  (actions: install | uninstall | status)
  ${pad('verify-interface')}its PreToolUse gate blocks any \`ruflo-*\` binary — and plain English prose —
  ${pad('')}  with a documented override that cannot work (stuinfla/ruvnet-brain#12)
  ${pad('design-wall')}its design-grade commit gate never checks which repo it's running in —
  ${pad('')}  an unrelated repo's plain README.md commit trips the same visual-design wall

Plugin patches (all ruflo plugins)  (actions: install | uninstall | status)
  ${pad('mcp-prefix')}bundled skills/agents name tools \`mcp__claude-flow__*\`, which never resolve
  ${pad('')}  under plugin loading — rewrites them to \`mcp__plugin_ruflo-core_ruflo__*\` (#2685)

Keep it live                   (actions: install | uninstall | status | run | check)
  ${pad('monitor')}re-apply patches when npx/ruflo-update/plugin-update overwrites them

Repair a project                 npx … cleanup [dir] [--dry-run] [--all-daemons]
  ${pad('cleanup')}kill a project's stray daemons + remove subdir .claude-flow/.swarm

Script targets                 (actions: install | uninstall | status | run <args…>)
  ${pad('dual-codex-claude')}${SCRIPT_TARGETS['dual-codex-claude'].blurb}  (alias: dual)
  ${pad('plugin-only')}${SCRIPT_TARGETS['dedupe-bundle'].blurb}  (aliases: dedupe, dedupe-bundle)
  ${pad('')}\`run\` materializes the script and executes it, forwarding your args

The whole setup, in one line:
  npx github:sparkling/ruflo-source-patch all install        # every target + monitor

Run a script directly (no separate install step):
  npx github:sparkling/ruflo-source-patch plugin-only run . --dry-run
  npx github:sparkling/ruflo-source-patch dual run <project-path>

Other:
  npx github:sparkling/ruflo-source-patch memory uninstall   # drop one, keep the rest
  npx github:sparkling/ruflo-source-patch all status         # every target at once
  npx github:sparkling/ruflo-source-patch monitor check      # exit 1 if anything drifted
  npx github:sparkling/ruflo-source-patch cleanup . --dry-run

Working with ADRs? Install all three — they cover the whole round-trip:
  npx github:sparkling/ruflo-source-patch adr-template install   # what adr-create WRITES
  npx github:sparkling/ruflo-source-patch adr-index install      # what adr-index READS BACK
  npx github:sparkling/ruflo-source-patch adr-reindex install    # the /adr-reindex skill — reap DELETIONS`);
}

const [rawTarget, rawAction] = process.argv.slice(2);

if (!rawTarget || ['help', '--help', '-h'].includes(rawTarget)) {
  usage();
  process.exit(0);
}

// A bare action names no target. Don't guess — say which targets exist.
if (rawTarget === 'cleanup') {
  const rest = process.argv.slice(3);
  const dir = rest.find((a) => !a.startsWith('-')) || process.cwd();
  const opts = { dryRun: rest.includes('--dry-run'), allDaemons: rest.includes('--all-daemons') };
  const r = runCleanup(dir, opts);
  for (const l of r.log) console.log(`[cleanup] ${l}`);
  // `refused` (too-broad root) and any failed kill/removal are failures. This used to exit 0
  // unconditionally — including on a run that refused to do anything at all.
  process.exit(r.refused || r.failures ? 1 : 0);
}

if (ACTIONS.has(rawTarget) && !rawAction) {
  console.error(`[ruflo-source-patch] \`${rawTarget}\` needs a target, e.g. \`cwd ${rawTarget}\`.`);
  usage();
  process.exit(1);
}

const target = ALIASES[rawTarget] || rawTarget;
const action = rawAction;

if (!action) {
  console.error(`[ruflo-source-patch] target "${target}" needs an action (install | uninstall | status)`);
  usage();
  process.exit(1);
}

// Refresh the stable copy on every MUTATING invocation, not just `install`.
//
// ~/.ruflo-source-patch/lib is what the SessionStart hook and the monitor execute. It was
// written only by an install action, so upgrading the package changed nothing about what either
// of them actually ran — silently, and for good. This process IS the package, so it is the one
// thing that always knows the current bytes.
//
// But NOT on the read-only actions. `status` and `check` exist to tell you what is true, and a
// command that heals the drift on its way to looking for it can only ever report `none` — the
// STALE-LIB gate would be unreachable, a check that cannot fail. Read-only commands observe;
// mutating commands repair. (The monitor repairs too, on its own tick — see stable.mjs.)
const READ_ONLY = new Set(['status', 'check']);
try {
  if (!READ_ONLY.has(action)) {
    const { readState, isEmpty } = await import('../lib/cwd/state.mjs');
    // Guarded on "something is installed": with an empty state there is no hook and no monitor,
    // so there is nothing to keep current, and no reason to create a stable dir.
    if (!isEmpty(readState())) {
      const { syncStableCopy } = await import('../lib/cwd/commands.mjs');
      syncStableCopy();
    }
  }
} catch { /* never let a refresh break the command the user actually asked for */ }

// `install` on a RETIRED target refuses, and that is the whole of the retirement UI.
//
// It has to refuse: the SessionStart hook re-applies everything in state.json and `make install` installs
// every target, so a retirement with no memory of itself would be undone within the hour, re-done on the
// next monitor tick, and flip-flop forever.
//
// There is deliberately no `unretire` and no `pin`. A target retires only when its replacement is proven
// PRESENT and RUNNABLE on this machine, so "I disagree" is not a state the tool needs to model — and every
// override is another surface to test, document and get wrong. If the predicate is right, the answer is
// right; if the predicate is wrong, fix the predicate.
if (PATCH_TARGETS.includes(target) || PLUGIN_PATCH_TARGETS[target]) {
  const { readState, isRetired } = await import('../lib/cwd/state.mjs');
  if ((action === 'install' || action === 'init') && isRetired(target)) {
    const r = readState().retired[target];
    const say = (m) => console.log(`[${target}] ${m}`);
    say(`RETIRED on ${r.at}, and not re-installed: ${r.reason}.`);
    say(`  evidence: ${r.evidence}`);
    if (r.issue) say(`  upstream: ${r.issue}`);
    say('Not a failure: upstream now does this job, and the replacement was verified on THIS machine.');
    process.exit(0);
  }
}

let ok;
if (target === 'all') {
  // The one-shot the Makefile used to own alone. `make install` requires cloning the repo; the npx
  // path — which is the PRIMARY one (self-update pulls tags, ADR-015) — had no equivalent, so a user
  // had to run seven targets by hand. `all` covers every PATCH + PLUGIN target and the monitor, in a
  // fixed order, and is pinned by a test to the SAME sets `make install` uses so the two cannot drift.
  //
  // adr-reindex is included deliberately, NOT special-cased: on a current CLI it installs and then
  // RETIRES ITSELF on proof (ADR-009/014); on an older one it stays. Either way `all` does the right
  // thing without knowing which case it is.
  if (!['install', 'init', 'uninstall', 'remove', 'status'].includes(action)) {
    console.error(`[ruflo-source-patch] \`all\` supports: install | uninstall | status (got "${action}")`);
    process.exit(1);
  }
  const { readState, isRetired, setAllMode } = await import('../lib/cwd/state.mjs');
  const st = readState();
  let bad = 0;

  // The three CLI patch targets compose in ONE file-rebuild, so patchCommand takes them as a set —
  // one call, one status table (looping them would re-render the whole table per target).
  if (!patchCommand(PATCH_TARGETS, action)) bad++;

  // The plugin targets are independent, and adr-reindex can be RETIRED. Loop them, and never let `all`
  // resurrect a retired target on install — the single-target path refuses this, so `all` must not be a
  // back door around it. (uninstall/status still touch it, harmlessly.)
  for (const t of Object.keys(PLUGIN_PATCH_TARGETS)) {
    if ((action === 'install' || action === 'init') && isRetired(t, st)) {
      console.log(`[${t}] retired — skipped (upstream now does this; \`${t} status\` for why)`);
      continue;
    }
    if (!PLUGIN_PATCH_TARGETS[t](action)) bad++;
  }

  // The monitor keeps them live; on uninstall it comes down too; status reports it alongside.
  monitorCommand(action === 'install' || action === 'init' ? 'install'
    : action === 'uninstall' || action === 'remove' ? 'uninstall' : 'status');
  // Record (or clear) the "track the complete set" contract. This is the ONE bit the self-update reads to
  // decide whether a target introduced in a later release adopts itself (ADR-019). `status` leaves it be.
  if (action === 'install' || action === 'init') setAllMode(true);
  else if (action === 'uninstall' || action === 'remove') setAllMode(false);
  ok = bad === 0;
} else if (target === 'monitor') {
  ok = monitorCommand(action);
} else if (PATCH_TARGETS.includes(target)) {
  ok = patchCommand([target], action);
} else if (PLUGIN_PATCH_TARGETS[target]) {
  ok = PLUGIN_PATCH_TARGETS[target](action);
} else if (SCRIPT_TARGETS[target]) {
  // `run` forwards everything after the action to the script (e.g. `dedupe-bundle run . --dry-run`).
  ok = scriptCommand(target, action, process.argv.slice(4));
} else {
  const known = ['all', ...PATCH_TARGETS, ...Object.keys(PLUGIN_PATCH_TARGETS), 'monitor', 'cleanup', ...Object.keys(SCRIPT_TARGETS)].join(' | ');
  console.error(`[ruflo-source-patch] unknown target "${target}" (expected: ${known})`);
  usage();
  process.exit(1);
}

// Uninstalling ONE target is a deviation from "everything, kept live": the moment you curate a subset,
// stop tracking the complete set, or the next self-update's `all install` would just re-add what you
// removed (ADR-019). Installing one target does NOT clear it — adding to a set you already track is no
// deviation. `all uninstall` clears it via its own branch above.
if ((action === 'uninstall' || action === 'remove')
    && (PATCH_TARGETS.includes(target) || PLUGIN_PATCH_TARGETS[target])) {
  const { setAllMode } = await import('../lib/cwd/state.mjs');
  setAllMode(false);
}

if (!ok) {
  console.error(`[ruflo-source-patch] unknown action "${action}" for target "${target}"`);
  usage();
  process.exit(1);
}
