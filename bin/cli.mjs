#!/usr/bin/env node
// ruflo-source-patch — multi-target CLI.
//
//   npx @sparkleideas/ruflo-source-patch <target> <action>
//
// Targets:
//   cwd                 patch @claude-flow/cli's process.cwd() anchoring at
//                       source (ruvnet/ruflo#2633) so .claude-flow/.swarm and
//                       daemons stop proliferating under Claude Code cwd drift.
//     actions: install|init · uninstall|remove · patch · revert · status
//
//   dual-codex-claude   install the single-source dual (Claude Code + Codex)
//     (alias: dual)     toolkit scripts to ~/.ruflo-source-patch/dual.
//     actions: install|init · uninstall|remove · status
//
// Backward compat: a bare action with no target (e.g. `install`) targets `cwd`.

import { cwdCommand } from '../lib/cwd/commands.mjs';
import { dualCommand } from '../lib/dual/commands.mjs';

const ACTIONS = new Set(['install', 'init', 'uninstall', 'remove', 'patch', 'revert', 'status']);

function usage() {
  console.log(`ruflo-source-patch — patch ruflo/@claude-flow at source, and set up dual Codex+Claude projects

Usage:
  npx @sparkleideas/ruflo-source-patch <target> <action>

Targets & actions:
  cwd                install | init | uninstall | remove | patch | revert | status
  dual-codex-claude  install | init | uninstall | remove | status   (alias: dual)

Examples:
  npx @sparkleideas/ruflo-source-patch cwd install
  npx @sparkleideas/ruflo-source-patch cwd uninstall
  npx @sparkleideas/ruflo-source-patch dual-codex-claude install
  npx @sparkleideas/ruflo-source-patch dual-codex-claude uninstall`);
}

const [a1, a2] = process.argv.slice(2);

let target;
let action;

if (!a1 || a1 === 'help' || a1 === '--help' || a1 === '-h') {
  usage();
  process.exit(0);
} else if (ACTIONS.has(a1) && !a2) {
  // Backward compat: bare action -> cwd target.
  target = 'cwd';
  action = a1;
} else {
  target = a1;
  action = a2;
}

if (!action) {
  console.error(`[ruflo-source-patch] target "${target}" needs an action (install | uninstall | ...)`);
  usage();
  process.exit(1);
}

let ok;
if (target === 'cwd') {
  ok = cwdCommand(action);
} else if (target === 'dual-codex-claude' || target === 'dual') {
  ok = dualCommand(action);
} else {
  console.error(`[ruflo-source-patch] unknown target "${target}" (expected: cwd | dual-codex-claude)`);
  usage();
  process.exit(1);
}

if (!ok) {
  console.error(`[ruflo-source-patch] unknown action "${action}" for target "${target}"`);
  usage();
  process.exit(1);
}
