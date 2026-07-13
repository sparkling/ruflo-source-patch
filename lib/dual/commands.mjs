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
//   adr-reindex         rebuild a project's ADR index + dependency graph from
//                       docs/adr/. The `adr-index` PATCH target makes an ordinary
//                       re-import converge (#2660); this reconciles DELETIONS,
//                       which upsert cannot reap. Needs raw SQL — the CLI has no
//                       hard delete (#2652).
//                       -> ~/.ruflo-source-patch/adr-reindex/
//
// Each target owns its OWN directory and its OWN file list, so installing or
// uninstalling one never touches the other's scripts.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { DUAL_DIR, DEDUPE_DIR, ADR_REINDEX_DIR } from '../cwd/paths.mjs';

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
  'adr-reindex': {
    dir: ADR_REINDEX_DIR,
    files: ['ruflo-adr-reindex.sh'],
    dirs: [],
    entry: 'ruflo-adr-reindex.sh',
    usage: '[project-dir] [--dry-run]',
    blurb: 'rebuild a project ADR index — reconciles deletions upsert cannot reap (#2660)',
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

// Every packaged file of a target, as repo-relative paths — the files themselves plus
// everything under its `dirs`.
function packagedFiles(spec) {
  const out = [...spec.files];
  const walk = (rel) => {
    const abs = path.join(__dirname, rel);
    if (!fs.existsSync(abs)) return;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const child = path.join(rel, entry.name);
      if (entry.isDirectory()) walk(child);
      else out.push(child);
    }
  };
  for (const d of spec.dirs) walk(d);
  return out;
}

// Which installed files differ from the ones this package ships?
//
// A script target is materialized ONCE at install and has no hook and no monitor behind it
// — so when the package is upgraded, the copy under ~/.ruflo-source-patch keeps running the
// OLD script forever. Reporting `installed` on existence alone made that invisible: the
// stale copy and a current one look identical. So compare the bytes. `missing` and `stale`
// are distinct because they need different words, not because they need different fixes —
// `install` is an overwrite, and it repairs both.
function driftedFiles(spec) {
  const missing = [];
  const stale = [];
  for (const rel of packagedFiles(spec)) {
    const src = path.join(__dirname, rel);
    const dest = path.join(spec.dir, rel);
    if (!fs.existsSync(dest)) { missing.push(rel); continue; }
    if (!fs.readFileSync(src).equals(fs.readFileSync(dest))) stale.push(rel);
  }
  return { missing, stale };
}

export function scriptCommand(targetKey, action) {
  const spec = SCRIPT_TARGETS[targetKey];
  if (!spec) return false;
  const log = (m) => console.log(`[${targetKey}] ${m}`);

  if (action === 'install' || action === 'init') {
    fs.mkdirSync(spec.dir, { recursive: true });
    // Count what did NOT land. This used to log `missing packaged script: X`, carry on, and then
    // print `installed to <dir>` and exit 0 — so a half-materialized target was indistinguishable
    // from a complete one to a human AND to `make`.
    const failed = [];
    for (const f of spec.files) {
      const src = path.join(__dirname, f);
      if (!fs.existsSync(src)) { failed.push(`${f} (not in the package)`); continue; }
      const dest = path.join(spec.dir, f);
      try {
        fs.copyFileSync(src, dest);
        fs.chmodSync(dest, 0o755);
        log(`  ${dest}`);
      } catch (err) { failed.push(`${f} (${err.message})`); }
    }
    for (const d of spec.dirs) {
      const src = path.join(__dirname, d);
      if (!fs.existsSync(src)) { failed.push(`${d}/ (not in the package)`); continue; }
      try { copyTree(src, path.join(spec.dir, d)); } catch (err) { failed.push(`${d}/ (${err.message})`); }
    }

    if (failed.length) {
      for (const f of failed) log(`FAILED  ${f}`);
      log(`INCOMPLETE — ${failed.length} item(s) did not install; do NOT rely on ${spec.entry}`);
      process.exitCode = 1;
      return true;
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
    if (!fs.existsSync(path.join(spec.dir, spec.entry))) {
      log(`not installed  (${spec.dir})`);
      return true;
    }
    const { missing, stale } = driftedFiles(spec);
    if (!missing.length && !stale.length) {
      log(`installed, current  (${spec.dir})`);
      return true;
    }
    for (const f of stale) log(`STALE  ${f} — installed copy differs from the packaged one`);
    for (const f of missing) log(`MISSING  ${f} — packaged, but not installed`);
    log(`installed but OUT OF DATE (${stale.length} stale, ${missing.length} missing) — re-run \`${targetKey} install\``);
  } else {
    return false;
  }
  return true;
}
