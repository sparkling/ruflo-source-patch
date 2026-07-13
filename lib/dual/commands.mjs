// Script targets — they materialize shell scripts at a stable path; they do NOT
// patch anything and register no Claude Code hook.
//
//   dual-codex-claude   create/convert a single-source dual (Claude Code + Codex)
//                       project: AGENTS.md is canonical, CLAUDE.md = @AGENTS.md.
//                       -> ~/.ruflo-source-patch/dual/
//
//   dedupe-bundle       clean up an EXISTING Claude project after `ruflo init --full`
//                       (or any preset): remove the .claude/{skills,commands,agents}
//                       entries the installed ruflo/* plugins already provide, and
//                       optionally the settings.json hooks that double-fire against
//                       the plugin hooks (ruvnet/ruflo#2640).
//                       -> ~/.ruflo-source-patch/dedupe-bundle/
//
// Each target owns its OWN directory and its OWN file list, so installing or
// uninstalling one never touches the other's scripts.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { DUAL_DIR, DEDUPE_DIR } from '../cwd/paths.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

export const SCRIPT_TARGETS = {
  'dual-codex-claude': {
    dir: DUAL_DIR,
    files: ['ruflo-add-codex.sh', 'ruflo-new-dual.sh'],
    dirs: ['templates'],
    entry: 'ruflo-add-codex.sh',
    usage: '<project-path>',
    blurb: 'single-source dual Claude Code + Codex project toolkit',
  },
  'dedupe-bundle': {
    dir: DEDUPE_DIR,
    files: ['ruflo-dedupe-bundle.sh'],
    dirs: [],
    entry: 'ruflo-dedupe-bundle.sh',
    usage: '<project-dir> [--strip-dup-hooks] [--dry-run]',
    blurb: 'slim an existing .claude bundle left by `ruflo init --full` (#2640)',
  },
};

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyTree(s, d);
    else {
      fs.copyFileSync(s, d);
      if (entry.name.endsWith('.sh')) fs.chmodSync(d, 0o755);
    }
  }
}

export function scriptCommand(targetKey, action) {
  const spec = SCRIPT_TARGETS[targetKey];
  if (!spec) return false;
  const log = (m) => console.log(`[${targetKey}] ${m}`);

  if (action === 'install' || action === 'init') {
    fs.mkdirSync(spec.dir, { recursive: true });
    for (const f of spec.files) {
      const src = path.join(__dirname, f);
      if (!fs.existsSync(src)) { log(`missing packaged script: ${f}`); continue; }
      const dest = path.join(spec.dir, f);
      fs.copyFileSync(src, dest);
      fs.chmodSync(dest, 0o755);
      log(`  ${dest}`);
    }
    for (const d of spec.dirs) {
      const src = path.join(__dirname, d);
      if (fs.existsSync(src)) copyTree(src, path.join(spec.dir, d));
    }
    log(`installed to ${spec.dir}`);
    log(`run:  ${path.join(spec.dir, spec.entry)} ${spec.usage}`);
  } else if (action === 'uninstall' || action === 'remove') {
    if (fs.existsSync(spec.dir)) {
      fs.rmSync(spec.dir, { recursive: true, force: true });
      log(`removed ${spec.dir}`);
    } else {
      log('nothing to remove (not installed)');
    }
  } else if (action === 'status') {
    const on = fs.existsSync(path.join(spec.dir, spec.entry));
    log(`${on ? 'installed' : 'not installed'}  (${spec.dir})`);
  } else {
    return false;
  }
  return true;
}
