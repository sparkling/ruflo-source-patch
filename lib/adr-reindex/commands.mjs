// Dispatch for the `adr-reindex` target.
//
// ONE target, TWO artifacts, because they are useless apart:
//
//   the SKILL   -> installed into the ruflo-adr plugin, so `/adr-reindex` exists next to
//                  `/adr-create`, `/adr-index`, `/adr-review`, `/adr-verify`.
//   the SCRIPT  -> materialized at ~/.ruflo-source-patch/adr-reindex/, which is what the skill (and the
//                  patched importer's ORPHANS line) actually invokes.
//
// A skill whose script is missing is a slash command that errors; a script with no skill is what we had
// before — a real fix nobody could find, surfaced only by an absolute path printed at the moment of
// failure. So they install and uninstall together.
//
// It is a PLUGIN target rather than a script target because the skill file lives inside someone else's
// plugin: a `/plugin update` re-fetches ruflo-adr wholesale and takes the skill with it, silently. Being
// a plugin target means state.json records it, and the SessionStart hook and the monitor put it back —
// the same machinery that keeps adr-template and adr-index alive through an update.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { apply, restore, status } from './patcher.mjs';
import { addPluginTargets, removePluginTargets, readState, isEmpty } from '../cwd/state.mjs';
import { installHook, removeHook } from '../cwd/hooks.mjs';
import { syncStableCopy } from '../cwd/commands.mjs';
import { ADR_REINDEX_DIR } from '../cwd/paths.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const SCRIPT_NAME = 'ruflo-adr-reindex.sh';
const SCRIPT_DEST = path.join(ADR_REINDEX_DIR, SCRIPT_NAME);

// The rebuild hard-deletes rows from memory.db. Without `memory/write-lock` no other ruflo process
// takes <db>.rsp-lock, so the delete races a daemon that can flush a pre-delete image back and
// resurrect everything (ruvnet/ruflo#2621). The script refuses at run time too — this check exists so
// the dependency is discovered at INSTALL time, not at the moment someone finally needs a reconcile.
const REQUIRES = ['memory'];

function materializeScript(log) {
  const src = path.join(__dirname, SCRIPT_NAME);
  if (!fs.existsSync(src)) {
    log(`FAILED ${SCRIPT_NAME} is not in the package — the /adr-reindex skill would invoke nothing`);
    return false;
  }
  try {
    fs.mkdirSync(ADR_REINDEX_DIR, { recursive: true });
    fs.copyFileSync(src, SCRIPT_DEST);
    fs.chmodSync(SCRIPT_DEST, 0o755);
    log(`  ${SCRIPT_DEST}`);
    return true;
  } catch (err) {
    log(`FAILED could not materialize ${SCRIPT_NAME}: ${err.message}`);
    return false;
  }
}

export function adrReindexCommand(action) {
  const log = (m) => console.log(`[adr-reindex] ${m}`);

  if (action === 'install' || action === 'init') {
    const missing = REQUIRES.filter((t) => !readState().patchTargets.includes(t));
    if (missing.length) {
      log(`requires the ${missing.join(', ')} patch target(s), which are not installed.`);
      log('It hard-deletes rows from memory.db; without the write lock a concurrent ruflo writer can');
      log('resurrect every row it removes (ruvnet/ruflo#2621). Install it first:');
      log(`  npx github:sparkling/ruflo-source-patch ${missing.join(' install && npx github:sparkling/ruflo-source-patch ')} install`);
      process.exitCode = 1;
      return true;
    }

    syncStableCopy();
    addPluginTargets(['adr-reindex']);
    const h = installHook();
    if (h.added) log('registered SessionStart hook');
    else if (h.updated) log('SessionStart hook path refreshed');

    const okScript = materializeScript(log);

    const r = apply();
    for (const l of r.log) log(l);
    log(`skill: patched ${r.patched}, unchanged ${r.unchanged}, skipped ${r.skipped}${r.errors ? `, ERRORS ${r.errors}` : ''}`);

    if (!okScript || r.errors) {
      log('INCOMPLETE — do not rely on /adr-reindex');
      process.exitCode = 1;
      return true;
    }
    log('use it as `/adr-reindex` — re-applied on session start and by the monitor (survives /plugin update)');
    return true;
  }

  if (action === 'uninstall' || action === 'remove') {
    const state = removePluginTargets(['adr-reindex']);

    const r = restore();
    for (const l of r.log) log(l);
    log(r.restored ? `removed the skill from ${r.restored} plugin copy/copies` : 'no skill to remove');

    if (fs.existsSync(ADR_REINDEX_DIR)) {
      fs.rmSync(ADR_REINDEX_DIR, { recursive: true, force: true });
      log(`removed ${ADR_REINDEX_DIR}`);
    }

    if (isEmpty(state)) {
      const h = removeHook();
      if (h.removed) log('nothing left installed — SessionStart hook removed');
    }
    return true;
  }

  if (action === 'status') {
    const installed = readState().pluginTargets.includes('adr-reindex');
    const s = status();
    for (const l of s.log) log(l);

    // Both halves, or it does not work. A skill whose script is missing is a slash command that errors.
    log(fs.existsSync(SCRIPT_DEST)
      ? `script: installed (${SCRIPT_DEST})`
      : `script: MISSING (${SCRIPT_DEST}) — /adr-reindex would invoke nothing; re-run install`);
    log(`${s.patched}/${s.files} plugin copy/copies carry the skill — ${installed ? 'tracked (re-applied on session start + monitor)' : 'NOT tracked (run `adr-reindex install` so it survives /plugin update)'}`);
    return true;
  }

  return false;
}
