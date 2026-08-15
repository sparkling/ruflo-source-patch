// Where the tests get their PRISTINE vendor bytes from.
//
// Both suites used to hardcode this machine: an absolute repo path, an npx cache hash
// (`_npx/9806d7724c607a8d`), and a plugin version (`0.3.0`). None of that survives contact with
// another checkout, another machine, or a `ruflo` upgrade — the suites simply could not run.
//
// The worse half was the fixture fallback: `exists(f + '.rsp-backup') ? backup : f`. On a machine
// where the patch IS installed and the backup has been cleaned away, that quietly adopts a
// PATCHED file as the pristine baseline — and then I1 ("entry applied <=> target installed") and
// I3 ("state empty => byte-identical to pristine") both assert against a baseline that already
// contains the patch. They pass. They are testing nothing. For a suite whose entire job is to
// prove that a failure cannot masquerade as success, silently fabricating its own baseline is
// the one bug it must never have.
//
// So: discover the vendor copies, and REFUSE a baseline we cannot prove is pristine.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import url from 'node:url';
import { GLOBAL_ROOTS, PATCH_MARKER } from '../lib/cwd/paths.mjs';
// HAZARD FOR CALLERS: this pulls in paths.mjs's HOME_BASE (a module-level constant, frozen at
// import time from RUFLO_SOURCE_PATCH_HOME) transitively through every patcher plugin-compose.mjs
// composes. Every EXISTING caller of this file is safe: none of them ever call a HOME_BASE-dependent
// function (discover(), applyComposed(), reconcile()...) in THEIR OWN process — they only use
// pristineBytes()/findVendorRoot() (which deliberately read the REAL machine, unaffected either way)
// and do all actual patching in a SPAWNED CHILD process (bin/cli.mjs with a sandboxed env), which
// reads its own environment fresh. If you add a caller that composes/patches IN-PROCESS (like
// test/mcp-prefix.mjs and test/design-wall.mjs do), it MUST set RUFLO_SOURCE_PATCH_HOME and then
// DYNAMICALLY `await import('./fixtures.mjs')` — never a static top-of-file import — or it will
// silently operate against THIS MACHINE'S REAL files instead of its sandbox. Measured live.
import { descriptor as adrTemplateDescriptor } from '../lib/adr-template/patcher.mjs';
import { descriptor as mcpPrefixDescriptor } from '../lib/mcp-prefix/patcher.mjs';
import { readState } from '../lib/cwd/state.mjs';

/** The repo root, from this file's own location. Never an absolute path typed by hand. */
export const REPO = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));

const die = (msg) => {
  console.error(`\n✘ cannot run: ${msg}\n`);
  process.exit(1);
};

/**
 * The node_modules holding @claude-flow/cli — whichever npx cache entry or global root has it.
 * The npx hash is content-addressed and changes whenever the dependency set does, so it can only
 * ever be discovered, never written down.
 */
function vendorRoots() {
  const roots = [];
  const npx = path.join(os.homedir(), '.npm', '_npx');
  try {
    for (const h of fs.readdirSync(npx)) roots.push(path.join(npx, h, 'node_modules'));
  } catch { /* no npx cache */ }
  for (const globalRoot of GLOBAL_ROOTS) {
    roots.push(globalRoot);
    roots.push(path.join(globalRoot, 'ruflo', 'node_modules'));
  }
  return [...new Set(roots)];
}

export function findVendorRoot() {
  const found = vendorRoots().find((r) => fs.existsSync(path.join(r, '@claude-flow', 'cli', 'dist')));
  if (!found) {
    die('@claude-flow/cli is not installed anywhere this test can find.\n'
      + '  The fuzz suite patches REAL vendor bytes — it needs them present.\n'
      + '  Fix:  npx @claude-flow/cli@latest --version');
  }
  return found;
}

/** Find a real CLI copy whose pristine form contains every requested exact anchor. */
export function findVendorRootWith(relativeFile, anchors) {
  const found = vendorRoots().find((root) => {
    const file = path.join(root, '@claude-flow', 'cli', relativeFile);
    const candidate = fs.existsSync(`${file}.rsp-backup`) ? `${file}.rsp-backup` : file;
    if (!fs.existsSync(candidate)) return false;
    const source = fs.readFileSync(candidate, 'utf8');
    if (source.includes(PATCH_MARKER) || source.includes('ruflo-source-patch(init)')) return false;
    return anchors.every((anchor) => source.includes(anchor));
  });
  if (!found) {
    die(`no installed @claude-flow/cli has ${relativeFile} with the required pristine anchors`);
  }
  return found;
}

/** The newest installed ruflo-adr plugin directory. The version is discovered, never pinned. */
export function findPluginRoot() {
  const base = path.join(os.homedir(), '.claude', 'plugins', 'cache', 'ruflo', 'ruflo-adr');
  let versions = [];
  try {
    versions = fs.readdirSync(base).filter((v) => fs.existsSync(path.join(base, v, 'scripts', 'import.mjs')));
  } catch { /* not installed */ }
  if (!versions.length) {
    die('the ruflo-adr plugin is not installed.\n'
      + '  The plugin suite patches its REAL files — it needs them present.\n'
      + '  Fix:  install the ruflo-adr plugin in Claude Code.');
  }
  versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return { dir: path.join(base, versions[versions.length - 1]), version: versions[versions.length - 1] };
}

// How to tell, for a given vendor file, whether OUR patch is already in it.
//
// The CLI targets stamp PATCH_MARKER into every file they touch. The plugin patches cannot —
// PATCH_MARKER is a JS block comment and one of their targets is a markdown SKILL.md — so each
// is recognised by a string only its patch introduces.
const looksPatched = {
  marker: (buf) => buf.includes(PATCH_MARKER),
  // The init entries are edits-only, so composePrelude() emits no generic PATCH_MARKER.
  // Their literal replacement marker is the only honest way to reject a patched baseline.
  init: (buf) => buf.includes('ruflo-source-patch(init)'),
  adrIndex: (buf) => buf.includes('ruflo-source-patch (#2660)'),
  // NOT `buf.includes('   **Status**: proposed')` alone — that only catches adr-template's OWN
  // signature. adr-create/SKILL.md is composed by mcp-prefix too (ADR-020), and a file mcp-prefix
  // patched but adr-template never touched would pass this narrow check as "clean vendor" — which
  // is exactly what let a genuinely-patched fixture masquerade as pristine and mask the
  // poisoned-backup bug (plugin-notify.mjs's P1). Once mcp-prefix is terminally retired, however,
  // its replacement token is native upstream content and is no longer a local patch signature.
  adrTemplate: (buf) => adrTemplateDescriptor.isPatched(buf)
    || (readState().pluginTargets.includes('mcp-prefix') && mcpPrefixDescriptor.isPatched(buf)),
  verifyInterface: (buf) => buf.includes('(^|[[:space:]]|[;&|(])($TOOLS)'),
  designWall: (buf) => buf.includes('ORIGIN=$(git -C') && buf.includes('*"ruvnet-brain"*'),
};

/**
 * The pristine bytes for one vendor file.
 *
 * Order matters, and the last branch is the point of the whole module:
 *   1. a non-empty .rsp-backup with no local patch signature is the best available pristine.
 *   2. a file our patch is not in is pristine.
 *   3. a PATCHED file with no backup is NOT a baseline, and we refuse it. Using it would make
 *      the suite green while testing the patch against itself.
 *
 * `kind` picks the recogniser: 'marker' (CLI targets), 'adrIndex', or 'adrTemplate'.
 */
export function pristineBytes(file, kind = 'marker') {
  const backup = `${file}.rsp-backup`;
  const patched = looksPatched[kind] || looksPatched.marker;
  if (fs.existsSync(backup)) {
    const buf = fs.readFileSync(backup);
    if (!buf.length || patched(buf.toString('utf8'))) {
      die(`${backup}\n  is empty or still carries a local patch signature, so it is not a valid pristine fixture.\n`
        + '  Reinstall the affected package/plugin before running acceptance tests.');
    }
    return buf;
  }
  if (!fs.existsSync(file)) die(`missing vendor fixture: ${file}`);

  const buf = fs.readFileSync(file);
  if (patched(buf.toString('utf8'))) {
    die(`${file}\n  is PATCHED and has no .rsp-backup, so there is no pristine baseline to test against.\n`
      + '  Using it would silently test the patch against itself and pass.\n'
      + '  Fix:  uninstall the relevant target (which restores the vendor bytes), then re-run.');
  }
  return buf;
}
