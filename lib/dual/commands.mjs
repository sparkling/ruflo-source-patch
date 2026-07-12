// Target: dual-codex-claude — the single-source dual (Claude Code + Codex)
// toolkit. Actions: install (copy the scripts into ~/.ruflo-source-patch/dual),
// uninstall (remove them), status.
//
// These are shell scripts the user runs directly against a project, e.g.
//   ~/.ruflo-source-patch/dual/ruflo-add-codex.sh <project-path>
// so "install" just materializes them at a stable path and marks them
// executable; it does not register any Claude Code hook.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { DUAL_DIR } from '../cwd/paths.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

function log(m) { console.log(`[dual-codex-claude] ${m}`); }

// Recursively copy the packaged toolkit (this module's dir, minus this .mjs)
// into DUAL_DIR, preserving executability of .sh scripts.
function copyToolkit(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name === 'commands.mjs') continue; // packaging code, not toolkit
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyToolkit(src, dest);
    } else {
      fs.copyFileSync(src, dest);
      if (entry.name.endsWith('.sh')) fs.chmodSync(dest, 0o755);
    }
  }
}

export function dualCommand(action) {
  if (action === 'install' || action === 'init') {
    copyToolkit(__dirname, DUAL_DIR);
    const scripts = fs.readdirSync(DUAL_DIR).filter((f) => f.endsWith('.sh')).sort();
    log(`toolkit installed to ${DUAL_DIR}`);
    for (const s of scripts) log(`  ${path.join(DUAL_DIR, s)}`);
    log('run e.g.:  ' + path.join(DUAL_DIR, 'ruflo-add-codex.sh') + ' <project-path>');
    log('done');
  } else if (action === 'uninstall' || action === 'remove') {
    if (fs.existsSync(DUAL_DIR)) {
      fs.rmSync(DUAL_DIR, { recursive: true, force: true });
      log(`removed ${DUAL_DIR}`);
    } else {
      log('nothing to remove (not installed)');
    }
    log('done');
  } else if (action === 'status') {
    log(`installed: ${fs.existsSync(DUAL_DIR)} (${DUAL_DIR})`);
  } else {
    return false;
  }
  return true;
}
