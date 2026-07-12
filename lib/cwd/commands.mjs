// Target: cwd — patches @claude-flow/cli's process.cwd() anchoring at source
// (ruvnet/ruflo#2633). Actions: install|init, uninstall|remove, patch, revert,
// status.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { run } from './patch-library.mjs';
import { installHook, removeHook } from './hooks.mjs';
import { STABLE_LIB, SETTINGS_PATH, HOOK_MARKER, NPX_ROOT } from './paths.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

function log(m) { console.log(`[cwd] ${m}`); }

// Copy this module's own dir (lib/cwd/*.mjs) into the stable runtime dir, so the
// always-firing SessionStart hook never depends on the npx cache.
function syncStableCopy() {
  fs.mkdirSync(STABLE_LIB, { recursive: true });
  for (const f of fs.readdirSync(__dirname)) {
    if (f.endsWith('.mjs')) fs.copyFileSync(path.join(__dirname, f), path.join(STABLE_LIB, f));
  }
}

export function cwdCommand(action) {
  if (action === 'install' || action === 'init') {
    syncStableCopy();
    log(`runtime copied to ${STABLE_LIB}`);
    const h = installHook();
    log(h.added ? 'registered SessionStart hook' : 'SessionStart hook already present — no-op');
    const r = run({ revert: false });
    for (const l of r.log) log(l);
    log(`patched ${r.patched}, skipped ${r.skipped}`);
    log('done');
  } else if (action === 'uninstall' || action === 'remove') {
    const r = run({ revert: true });
    for (const l of r.log) log(l);
    log(`reverted ${r.reverted}`);
    const h = removeHook();
    log(h.removed ? `removed ${h.removed} SessionStart hook(s)` : 'no hook to remove');
    log('done (stable runtime dir left in place; delete ~/.ruflo-source-patch/lib to fully remove)');
  } else if (action === 'patch') {
    const r = run({ revert: false });
    for (const l of r.log) log(l);
    log(`patched ${r.patched}, skipped ${r.skipped}`);
  } else if (action === 'revert') {
    const r = run({ revert: true });
    for (const l of r.log) log(l);
    log(`reverted ${r.reverted}`);
  } else if (action === 'status') {
    log(`npx root: ${NPX_ROOT}`);
    let settings = {};
    try { settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); } catch { /* none */ }
    const hooked = (settings.hooks?.SessionStart || []).some((g) =>
      (g.hooks || []).some((h) => h && h[HOOK_MARKER] === true));
    log(`SessionStart hook installed: ${hooked}`);
  } else {
    return false; // unknown action
  }
  return true;
}
