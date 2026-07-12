#!/usr/bin/env node
// ruflo-source-patch CLI
//
//   ruflo-source-patch install     copy runtime to a stable dir, register the
//     (alias: init)                SessionStart hook, patch current npx caches
//   ruflo-source-patch uninstall   revert every patched file, remove the hook
//     (alias: remove)
//   ruflo-source-patch patch       patch now (no hook change)
//   ruflo-source-patch revert      revert now (no hook change)
//   ruflo-source-patch status      show what's patched / hook state

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { run } from '../lib/patch-library.mjs';
import { installHook, removeHook } from '../lib/hooks.mjs';
import { STABLE_LIB, SETTINGS_PATH, HOOK_MARKER, NPX_ROOT } from '../lib/paths.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const pkgLib = path.resolve(__dirname, '..', 'lib');

function log(m) { console.log(`[ruflo-source-patch] ${m}`); }

// Copy this package's lib/ into the stable runtime dir so the always-firing
// hook never depends on the npx cache or this package staying resolvable.
function syncStableCopy() {
  fs.mkdirSync(STABLE_LIB, { recursive: true });
  for (const f of fs.readdirSync(pkgLib)) {
    if (f.endsWith('.mjs')) fs.copyFileSync(path.join(pkgLib, f), path.join(STABLE_LIB, f));
  }
}

const cmd = process.argv[2] || 'help';

if (cmd === 'install' || cmd === 'init') {
  syncStableCopy();
  log(`runtime copied to ${STABLE_LIB}`);
  const h = installHook();
  log(h.added ? 'registered SessionStart hook' : 'SessionStart hook already present — no-op');
  const r = run({ revert: false });
  for (const l of r.log) log(l);
  log(`patched ${r.patched}, skipped ${r.skipped}`);
  log('done');
} else if (cmd === 'uninstall' || cmd === 'remove') {
  const r = run({ revert: true });
  for (const l of r.log) log(l);
  log(`reverted ${r.reverted}`);
  const h = removeHook();
  log(h.removed ? `removed ${h.removed} SessionStart hook(s)` : 'no hook to remove');
  log('done (stable runtime dir left in place; delete ~/.ruflo-source-patch to fully remove)');
} else if (cmd === 'patch') {
  const r = run({ revert: false });
  for (const l of r.log) log(l);
  log(`patched ${r.patched}, skipped ${r.skipped}`);
} else if (cmd === 'revert') {
  const r = run({ revert: true });
  for (const l of r.log) log(l);
  log(`reverted ${r.reverted}`);
} else if (cmd === 'status') {
  log(`npx root: ${NPX_ROOT}`);
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); } catch { /* none */ }
  const hooked = (settings.hooks?.SessionStart || []).some((g) =>
    (g.hooks || []).some((h) => h && h[HOOK_MARKER] === true));
  log(`SessionStart hook installed: ${hooked}`);
} else {
  console.log(`ruflo-source-patch — patch @claude-flow/cli's cwd-anchoring defect at source (ruvnet/ruflo#2633)

Usage:
  npx @sparkleideas/ruflo-source-patch install     install + patch, kept applied every session
  npx @sparkleideas/ruflo-source-patch init        alias for install
  npx @sparkleideas/ruflo-source-patch uninstall   revert everything, remove the hook
  npx @sparkleideas/ruflo-source-patch remove      alias for uninstall
  npx @sparkleideas/ruflo-source-patch patch       patch the current npx caches now
  npx @sparkleideas/ruflo-source-patch revert       revert the current npx caches now
  npx @sparkleideas/ruflo-source-patch status      show state`);
}
