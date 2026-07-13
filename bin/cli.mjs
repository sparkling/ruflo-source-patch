#!/usr/bin/env node
// ruflo-source-patch — multi-target CLI.
//
//   npx @sparkleideas/ruflo-source-patch <target> <action>
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
// Plugin patches (source patches to the installed `ruflo-adr` plugin, not
// @claude-flow/cli — same install/uninstall/status shape, different target file).
// The pair covers both ends of the ADR round-trip: what adr-create WRITES, and
// what adr-index READS BACK IN.
//   adr-template   adr-create's own template writes bullet-list metadata that
//                  adr-index's parser can't read (#2659)
//   adr-index      adr-index can't update a CHANGED ADR: records are frozen by a
//                  strict insert, edges duplicate on every run (#2660 / #2594)
//
// Infra target:
//   monitor  keep the patches live — a scheduled re-apply, because `npx` fetching a new
//            copy (or a `ruflo update`) silently replaces a patched file and the
//            SessionStart hook only fires at session START.
//
// Script targets (materialize scripts; no patching, no hook):
//   dual-codex-claude   single-source dual Claude Code + Codex project toolkit
//   dedupe-bundle       slim a .claude bundle left behind by `ruflo init --full` (#2640)
//   adr-reindex         rebuild a project's ADR index — reconciles the DELETIONS the
//                       adr-index patch's upsert cannot reap (#2660)
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

const ACTIONS = new Set(['install', 'init', 'uninstall', 'remove', 'status', 'run', 'check']);
const ALIASES = { dual: 'dual-codex-claude', dedupe: 'dedupe-bundle' };

// Plugin patches — same shape as PATCH_TARGETS, but they patch the installed
// `ruflo-adr` plugin rather than @claude-flow/cli, so they dispatch separately.
const PLUGIN_PATCH_TARGETS = {
  'adr-template': adrTemplateCommand,
  'adr-index': adrIndexCommand,
};

function usage() {
  const pad = (s) => s.padEnd(18);
  console.log(`ruflo-source-patch — patch ruflo/@claude-flow at source; project toolkits

Usage:
  npx @sparkleideas/ruflo-source-patch <target> <action>

Patch targets                  (actions: install | uninstall | status)
  ${pad('cwd')}${TARGET_INFO.cwd}
  ${pad('daemon')}${TARGET_INFO.daemon}
  ${pad('memory')}${TARGET_INFO.memory}

Plugin patches (ruflo-adr)     (actions: install | uninstall | status)
  ${pad('adr-template')}adr-create's own template writes unparseable bullet-list metadata (#2659)
  ${pad('adr-index')}adr-index can't update a changed ADR — frozen records, duplicate edges (#2660)

Keep it live                   (actions: install | uninstall | status | run | check)
  ${pad('monitor')}re-apply patches when npx/ruflo-update/plugin-update overwrites them

Repair a project                 npx … cleanup [dir] [--dry-run] [--all-daemons]
  ${pad('cleanup')}kill a project's stray daemons + remove subdir .claude-flow/.swarm

Script targets                 (actions: install | uninstall | status)
  ${pad('dual-codex-claude')}${SCRIPT_TARGETS['dual-codex-claude'].blurb}  (alias: dual)
  ${pad('dedupe-bundle')}${SCRIPT_TARGETS['dedupe-bundle'].blurb}  (alias: dedupe)
  ${pad('adr-reindex')}${SCRIPT_TARGETS['adr-reindex'].blurb}

Every target installs/uninstalls on its own. The usual setup:
  npx @sparkleideas/ruflo-source-patch cwd install
  npx @sparkleideas/ruflo-source-patch daemon install
  npx @sparkleideas/ruflo-source-patch memory install
  npx @sparkleideas/ruflo-source-patch monitor install    # keep them live

Other:
  npx @sparkleideas/ruflo-source-patch memory uninstall   # drop one, keep the rest
  npx @sparkleideas/ruflo-source-patch memory status
  npx @sparkleideas/ruflo-source-patch monitor check      # exit 1 if anything drifted
  npx @sparkleideas/ruflo-source-patch dedupe-bundle install
  npx @sparkleideas/ruflo-source-patch cleanup . --dry-run

Working with ADRs? Install the pair — they fix opposite ends of the same round-trip:
  npx @sparkleideas/ruflo-source-patch adr-template install   # what adr-create writes
  npx @sparkleideas/ruflo-source-patch adr-index install      # what adr-index reads back
  npx @sparkleideas/ruflo-source-patch adr-reindex install    # reconcile deletions`);
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

let ok;
if (target === 'monitor') {
  ok = monitorCommand(action);
} else if (PATCH_TARGETS.includes(target)) {
  ok = patchCommand([target], action);
} else if (PLUGIN_PATCH_TARGETS[target]) {
  ok = PLUGIN_PATCH_TARGETS[target](action);
} else if (SCRIPT_TARGETS[target]) {
  ok = scriptCommand(target, action);
} else {
  const known = [...PATCH_TARGETS, ...Object.keys(PLUGIN_PATCH_TARGETS), 'monitor', 'cleanup', ...Object.keys(SCRIPT_TARGETS)].join(' | ');
  console.error(`[ruflo-source-patch] unknown target "${target}" (expected: ${known})`);
  usage();
  process.exit(1);
}

if (!ok) {
  console.error(`[ruflo-source-patch] unknown action "${action}" for target "${target}"`);
  usage();
  process.exit(1);
}
