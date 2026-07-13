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
//   all      every patch target above
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
// Back-compat: a bare action with no target (e.g. `install`) applies to `all`, which is
// what a pre-2.0 `install` did.

import { patchCommand, monitorCommand } from '../lib/cwd/commands.mjs';
import { PATCH_TARGETS, TARGET_INFO } from '../lib/cwd/patch-library.mjs';
import { scriptCommand, SCRIPT_TARGETS } from '../lib/dual/commands.mjs';

const ACTIONS = new Set(['install', 'init', 'uninstall', 'remove', 'patch', 'revert', 'status']);
const ALIASES = { dual: 'dual-codex-claude', dedupe: 'dedupe-bundle' };

function usage() {
  const pad = (s) => s.padEnd(18);
  console.log(`ruflo-source-patch — patch ruflo/@claude-flow at source; project toolkits

Usage:
  npx @sparkleideas/ruflo-source-patch <target> <action>

Patch targets                  (actions: install | uninstall | patch | revert | status)
  ${pad('cwd')}${TARGET_INFO.cwd}
  ${pad('daemon')}${TARGET_INFO.daemon}
  ${pad('memory')}${TARGET_INFO.memory}
  ${pad('all')}every patch target above

Keep it live                   (actions: install | uninstall | status | run | check)
  ${pad('monitor')}re-apply patches when npx/ruflo-update overwrites them

Script targets                 (actions: install | uninstall | status)
  ${pad('dual-codex-claude')}${SCRIPT_TARGETS['dual-codex-claude'].blurb}  (alias: dual)
  ${pad('dedupe-bundle')}${SCRIPT_TARGETS['dedupe-bundle'].blurb}  (alias: dedupe)

Each target installs/uninstalls on its own — e.g. keep cwd, drop memory:
  npx @sparkleideas/ruflo-source-patch memory uninstall

Examples:
  npx @sparkleideas/ruflo-source-patch all install
  npx @sparkleideas/ruflo-source-patch daemon install
  npx @sparkleideas/ruflo-source-patch memory status
  npx @sparkleideas/ruflo-source-patch monitor install
  npx @sparkleideas/ruflo-source-patch monitor check      # exit 1 if anything drifted
  npx @sparkleideas/ruflo-source-patch dedupe-bundle install`);
}

const [rawTarget, rawAction] = process.argv.slice(2);

if (!rawTarget || ['help', '--help', '-h'].includes(rawTarget)) {
  usage();
  process.exit(0);
}

let target;
let action;

if (ACTIONS.has(rawTarget) && !rawAction) {
  // Back-compat: bare action -> every patch target (what pre-2.0 `install` did).
  target = 'all';
  action = rawTarget;
} else {
  target = ALIASES[rawTarget] || rawTarget;
  action = rawAction;
}

if (!action) {
  console.error(`[ruflo-source-patch] target "${target}" needs an action (install | uninstall | status | ...)`);
  usage();
  process.exit(1);
}

let ok;
if (target === 'monitor') {
  ok = monitorCommand(action);
} else if (target === 'all') {
  ok = patchCommand([...PATCH_TARGETS], action);
} else if (PATCH_TARGETS.includes(target)) {
  ok = patchCommand([target], action);
} else if (SCRIPT_TARGETS[target]) {
  ok = scriptCommand(target, action);
} else {
  const known = [...PATCH_TARGETS, 'all', 'monitor', ...Object.keys(SCRIPT_TARGETS)].join(' | ');
  console.error(`[ruflo-source-patch] unknown target "${target}" (expected: ${known})`);
  usage();
  process.exit(1);
}

if (!ok) {
  console.error(`[ruflo-source-patch] unknown action "${action}" for target "${target}"`);
  usage();
  process.exit(1);
}
